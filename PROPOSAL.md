# redis-hub: Rewrite Proposal

Status: draft for discussion. Nothing here is implemented yet.

## TL;DR

The core idea is good and worth keeping: **one process, named lazy-connected Redis
clients, shared by reference, reused across the app** (`publisher`, `subscriber`,
`user-123`, etc.). That's a real problem people hit constantly with `node-redis`
and this package's API surface (`redisHub.init()`, `useClient(name)`,
`defaultClient()`) is a genuinely pleasant shape.

The implementation underneath it has accumulated several bugs and design smells
that are easiest to fix by rewriting the hub internals (`RedisHub` class,
~160 lines) and the logging layer from scratch, while keeping the public API
close to what it is today (with a few deliberate breaking changes). This is not
a "burn it down and start over" situation — it's "the class doing the
connection bookkeeping needs to be redone, and the homegrown logger needs to be
replaced wholesale," which is exactly what you asked for.

## What's working — keep it

- **Named, lazily-created, shared clients.** `useClient('publisher')` /
  `useClient('subscriber')` as the idiom for pub/sub is the right answer to
  "you can't publish and subscribe on the same connection."
- **Global singleton via `globalThis`** (`src/shared.ts`) so the hub survives
  module duplication across bundlers/hot-reload. Good instinct, worth keeping.
- **Single source of default connection options** (`redisHub.init(...)`) so
  most call sites never pass options at all.
- **Thin wrapper, not a new abstraction over Redis commands.** You're not
  hiding `node-redis`'s API behind a leaky facade — client code still gets a
  real `RedisClientType`. Keep this restraint in the rewrite.

## Concrete problems in the current code

1. **`useClient()` with options silently breaks the "same name → same client"
   guarantee** (`src/helpers.ts:5-10`). When options are passed, it does
   `new RedisHub().client(name, options)` — a brand-new hub, not the shared
   one. That client is never registered in `SharedHub`, so a later
   `useClient(name)` call (no options) creates yet another, different client
   under the same name via the *real* shared hub. The README explicitly
   promises "Same clientId always returns the same connected client" — this
   code path violates that promise the moment anyone passes per-client
   options through `useClient`, which is the exact pattern shown in
   `EXAMPLE_USAGE.md` (the `news-story-publisher` / `news-story-subscriber`
   examples both pass options through `useClient`).

2. **Hub-level `status`/`error` fields race across clients**
   (`src/redis-hub.ts:23-24`, `137-162`). `this.status` and `this.error` are
   single fields on the hub, but `handleClientEvents` is bound per-client and
   overwrites them on every event from *any* client. With a `publisher` and a
   `subscriber` both connected, whichever fires last wins — there's no way to
   ask "what's the status of the subscriber specifically" from the hub
   itself. This matters more, not less, because the whole point of the
   package is running multiple named clients concurrently.

3. **Unbounded in-memory log buffer** (`src/utils/logger.ts:25,80`).
   `logger.logs` grows forever with no cap or rotation. On a long-running
   service with reconnect churn or high pub/sub volume, this is a slow memory
   leak. `redisHub.logs()` (`src/redis-hub.ts:130-132`) is documented as
   "useful when logging is disabled," which means the failure mode is
   invisible until it isn't.

4. **`conflictingOptions` only warns, never resolves** (`src/redis-hub.ts:86-92,
   104-109`). If you call `client('publisher', optsA)` then later
   `client('publisher', optsB)`, you silently keep getting the `optsA` client
   with a console warning buried in logs. That's a footgun for anyone who
   assumes passing options always applies them.

5. **Dead / misleading code**: `clientLogging` (`src/redis-hub.ts:22, 77`) is
   written but never read anywhere. `this.connect` (`src/redis-hub.ts:25-27`)
   is just `this.client` rebound under a different name for no apparent
   reason — two names for one method invites confusion about whether they
   differ.

6. **The "no options" guard doesn't actually guard anything**
   (`src/redis-hub.ts:70-76`). `defaultOptions` is initialized to `{}`, which
   is truthy, so `if (!clientOptions) throw ...` never fires even if
   `redisHub.init()` was never called — you instead get `createClient({name:
   clientId})` with no `url`, which just falls back to `redis`'s own default
   of `localhost:6379`, silently, with no indication that's what happened.

7. **`disconnectAll()` calls `client.destroy()`**, not `client.quit()`
   (`src/redis-hub.ts:120-125`) — a hard socket kill rather than a graceful
   drain of in-flight commands. Fine for a crash path, wrong as the *only*
   shutdown option.

8. **Config and connection options are the same object**
   (`src/types.ts:4-8`: `ClientOptions = RedisClientOptions & { clientId?,
   defaultClientName?, logging? }`). Hub-level config (`defaultClientName`,
   `logging`) and per-client Redis socket/auth options live in one flat bag.
   A typo in a hub-config key silently becomes a stray key inside the object
   passed to `createClient()`, and vice versa.

9. **No process lifecycle integration.** Nothing hooks `SIGTERM`/`SIGINT` to
   drain connections. Every consumer has to remember to call
   `redisHub.disconnectAll()` themselves on shutdown, or leak sockets on
   deploy/restart.

10. **README/example drift and naming.** `useClient` reads as a React hook to
    anyone who's touched frontend code in the last five years, which is a
    strange association for a Node backend utility — worth renaming.
    `EXAMPLE_USAGE.md` examples (Hapi-specific SSE streaming) are a fine
    illustration but don't match what's promoted in the README anymore.

None of this needs a ground-up rewrite of the concept — it needs the
`RedisHub` class rebuilt with per-client state instead of hub-global mutable
fields, and honest handling of the "already exists with different options"
case.

## Logging: replace the homegrown logger with pino

You asked for a mainstream, well-supported solution, full stop. My
recommendation is **[pino](https://github.com/pinojs/pino)**, not Winston:

- Fastest structured JSON logger in the Node ecosystem by a wide margin
  (matters here because logger calls sit on the hot path of every connect/
  reconnect/error event across every client).
- Structured-by-default output — trivially shippable to Datadog/CloudWatch/
  ELK/whatever the consuming app already uses, instead of the current
  `util.format` string blobs.
- Built-in **redaction** (`pino({redact: [...]})`) — directly relevant here
  since Redis connection options routinely contain passwords/URLs with
  embedded credentials that currently get logged verbatim on `connect`/
  `error` events.
- Child loggers (`logger.child({ client: 'publisher' })`) map cleanly onto
  "one logger context per named client," which fixes problem #2 above as a
  side effect — each client's logs are inherently tagged, no shared mutable
  state needed.

**Don't hard-wire pino as a mandatory dependency of every consumer, though.**
Accept an injected logger instead:

```ts
export type HubLogger = {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
};

redisHub.init({
  redis: { url: process.env.REDIS_URL },
  logger: pino({ level: 'info' }),   // any pino instance, a pino child, or...
  // logger: myWinstonLogger,        // ...anything satisfying the 4-method shape
  // logger: false,                  // ...or opt out entirely
});
```

This is pino's own recommended shape for library authors (it's literally the
`abstract-logging` interface pino itself implements), so consumers who
already run pino app-wide pass their existing instance/child logger straight
through with zero duplication, and consumers on Winston/Bunyan/whatever can
adapt in one line. Default to a bundled pino instance (`pretty` in dev,
plain JSON in prod, keyed off `NODE_ENV`) if nothing is passed, so it stays
plug-and-play out of the box — that's the whole value proposition of this
package. `pino` becomes a real `dependency` (it's small, has no bloated
transitive tree, and `pino-pretty` moves to `optionalDependencies` for dev
formatting).

The homegrown `Logger` class, `LogResult`, `LoggerConfig`, `LogLevel`, and
`redisHub.logs()` all go away. If you still want a way to introspect recent
activity without an external sink, that's better served by a small bounded
ring buffer (last N events, e.g. 50) purely for debugging — not an unbounded
history duplicating what the real logger already persists properly.

## Proposed shape

The goal: never make the consumer thread a `hub` variable through their own
module graph just to reuse it. `RedisHub` the class doubles as the access
point — its static methods delegate to one lazily-created, `globalThis`-guarded
shared instance (formalizing what `shared.ts` already does today, just
exposed directly on the class you're already importing, instead of via a
separate singleton export plus a family of bound helper functions). Calling
`new RedisHub(...)` remains available for anyone who explicitly wants an
*isolated* hub — a second Redis endpoint, test isolation, a multi-tenant
process — but it's the advanced path, not the one shown first.

```ts
// redis.ts — anywhere, or nowhere; config() is optional (see below)
import { RedisHub } from '@notross/redis-hub';
import pino from 'pino';

RedisHub.config({
  redis: { url: process.env.REDIS_URL },   // hub-wide default connection opts
  logger: pino(),                           // optional; pino-shaped injectable
  autoShutdown: true,                       // hooks SIGTERM/SIGINT -> graceful quit
});
```

```ts
// publisher.ts — no import of redis.ts, no shared variable, just the package
import { RedisHub } from '@notross/redis-hub';

const pub = await RedisHub.getClient('publisher');
await pub.publish('chat', 'hello');
```

```ts
// subscriber.ts — same story, own file, own import
import { RedisHub } from '@notross/redis-hub';

const sub = await RedisHub.getClient('subscriber', { redis: { /* per-client override */ } });
await sub.subscribe('chat', (msg) => console.log(msg));

// Per-client state instead of hub-global mutable fields (fixes bug #2).
RedisHub.getClientState('publisher'); // => { status: 'ready', lastError: null, connectedAt: ... }

await RedisHub.disconnect('publisher');  // graceful quit() for one client
await RedisHub.disconnectAll();          // graceful quit() for all, used by autoShutdown too
```

Every instance method (`getClient`, `getClientState`, `disconnect`,
`disconnectAll`, `config`, ...) exists as both an instance method and a
static that proxies to the shared instance, so `RedisHub.getClient(...)` and
`new RedisHub().getClient(...)` are the same method — one just always targets
the shared hub. This also means the exported surface collapses from today's
five names (`redisHub`, `redisClient`, `defaultClient`, `useClient`,
`RedisHub`) down to one (`RedisHub`), with a lowercase `redisHub` kept as a
plain alias to the shared instance for anyone who prefers
`import { redisHub } from '@notross/redis-hub'` destructuring-instance style
over static-method style — both resolve to the identical hub.

### Per-client handles

`RedisHub.getClient(name)` / `.getClientState(name)` / `.disconnect(name)`
all repeat the same `clientId` string at every call site. For the common
case — a file that owns exactly one named client — `RedisHub.handle(name,
options)` packages that one client's operations together so the name is
only written once:

```ts
// publisher.ts
import { RedisHub } from '@notross/redis-hub';

const publisher = RedisHub.handle('publisher', { redis: { /* per-client override */ } });

export async function publish(channel: string, message: string) {
  const client = await publisher.client;
  await client.publish(channel, message);
}

publisher.getState();          // => { status: 'ready', lastError: null, connectedAt: ... }
await publisher.disconnect();
```

`RedisHub.handle(...)` returns synchronously and doesn't connect anything by
itself — it's a bound closure over one `clientId`, not new hub state.
`.client` is a memoized promise property: the first access is what actually
triggers `RedisHub.getClient('publisher')` (and the real connection), every
later access returns that same promise, so repeated `await publisher.client`
calls never reconnect or re-fetch. `.getState()` and `.disconnect()` are
direct passthroughs to `RedisHub.getClientState('publisher')` /
`RedisHub.disconnect('publisher')` — pure sugar, nothing to keep in sync.
`RedisHub.getClient(name)` stays available directly for one-off/inline use;
`.handle(...)` is for the "this file owns this one named client" case.

### Zero-config resolution

`RedisHub.config(...)` becomes optional, not required. If `getClient()` is
called before `config()` was ever invoked, the hub resolves default
connection options lazily, once, in this order, and caches the result:

1. **`REDIS_HUB_URL`** — namespaced env var, wins if set. Lets you point
   redis-hub at a different instance than whatever `REDIS_URL` some other
   library in the same process might also be reading.
2. **`REDIS_URL`** — the de facto convention already set by Heroku, Railway,
   Render, Fly, etc. If it's already in the environment, there's nothing left
   to configure.
3. **A config file, resolved via [`cosmiconfig`](https://github.com/cosmiconfig/cosmiconfig)**
   (`cosmiconfig('redis-hub').search()`) — the same tool ESLint, Prettier,
   Stylelint, and Commitlint use for exactly this problem, rather than a
   hand-rolled single-filename loader. Searching upward from `cwd`, it picks
   up (in cosmiconfig's own search order): a `redis-hub` key in
   `package.json`, `.redis-hubrc(.json|.yaml|.yml|.js|.cjs|.mjs)`, or
   `redis-hub.config.(js|cjs|mjs|json)` — `.js`/`.cjs`/`.mjs`/`.ts` (with a
   loader) formats get correct ESM/CJS interop for free, which is genuinely
   easy to get subtly wrong by hand. **JS/TS-format config files can export
   the exact same shape you'd pass to `RedisHub.config({...})`** — functions
   included, so a `redis-hub.config.js` can supply a real `logger` instance
   or an `onOptionsConflict` handler, not just a bare URL. JSON/YAML formats
   are naturally limited to the serializable subset (`redis` connection
   options) since they can't carry functions.
4. **`redis://localhost:6379`** — last-resort default for local dev, same as
   `node-redis`'s own default.

Whichever source wins gets logged once at `debug` level ("redis-hub: no
explicit config() call; resolved connection from REDIS_URL") so the
zero-config path stays legible instead of feeling like silent magic in
production. An explicit `RedisHub.config(...)` call always overrides all of
the above, and per-client options passed to `getClient(name, options)`
override the hub default for that one client, same as today.

**`.env` files are deliberately not this package's concern.** `.env` support
is really just "is `REDIS_URL` already in `process.env`," and that's
populated by `dotenv` (or the deploy platform) *before* the hub ever runs —
step 2 above already covers it for free once that's loaded. The library
itself should not call `dotenv.config()` internally: a library reaching into
`.env` loading is presumptuous (wrong `cwd` relative to a monorepo package,
double-loading if the host app also uses `dotenv`, and it fights whatever
env strategy — `dotenv-flow`, Docker env, a process manager — the host app
already has). Worth a line in the README so "why isn't my `.env` picked up"
has an obvious answer: add `dotenv`/`import 'dotenv/config'` yourself,
upstream of anything that touches `RedisHub`.

`cosmiconfig` becomes a real `dependency` — it's small, purpose-built, and
the alternative (hand-rolling multi-format search) means re-implementing
something this library already gets right, for no benefit given the goal is
broad mainstream-format support rather than one fixed filename.

Key API changes from today:

- `redis` (connection options) and hub-level config (`logger`, `autoShutdown`,
  `defaultClientName`) are separate top-level keys — fixes bug #8.
- `init` → `config`; `useClient` → `getClient`, now reachable as a static on
  `RedisHub` itself so there's no per-file wiring — drop the accidental
  "options creates an orphan hub" branch entirely — fixes bug #1.
- Passing conflicting options for an existing client throws by default
  (`onOptionsConflict: 'throw' | 'warn' | 'ignore'`, configurable) instead of
  silently warning — fixes bug #4.
- `disconnect`/`disconnectAll` use `quit()` (graceful) with a `force` flag
  that falls back to `destroy()` after a timeout — fixes bug #7.
- Optional `autoShutdown` wires `SIGTERM`/`SIGINT` handlers — fixes bug #9.
- `config()` becomes fully optional — env vars / config file resolution means
  `RedisHub.getClient('publisher')` can be the very first line of code that
  touches the package, no setup file required.
- New `RedisHub.handle(clientId, options)` for files that own exactly one
  named client, so the client name isn't repeated at every call site.

Worth deciding explicitly rather than assuming: do you need **Redis Cluster
or Sentinel** support (`createCluster` from `node-redis`)? Nothing today
handles it, and it's a meaningfully different client shape. I'd leave it out
of v1 of the rewrite unless you already know you need it, and add it as a
`type: 'cluster'` variant later — happy to include it now if you want it from
day one.

## Testing

There currently is no test suite at all in this repo. For a connection-
management library, that's the highest-leverage gap to close in a rewrite —
this is exactly the kind of code (lazy init, shared state, reconnect/error
event wiring) that silently regresses without tests. Recommendation:

- **Vitest** for the runner (fast, native ESM, no ts-node ceremony).
- Run against a **real Redis** via `testcontainers` (spins up a disposable
  Redis container per test run) rather than mocking `node-redis` — mocking
  the client would just test that your mocks match your assumptions about
  Redis behavior, not that the hub actually works.
- Cover: same-name reuse, conflicting-options behavior, disconnect/
  reconnect event → state transitions, graceful shutdown draining in-flight
  commands, and the logger-injection contract.

## Tooling modernization (smaller, optional)

- Replace `nodemon --exec ts-node` with `tsx watch` — faster, one dependency
  instead of two.
- Consider **tsup** to replace the dual `tsc -p tsconfig.cjs.json` /
  `tsc -p tsconfig.esm.json` build plus the custom `prepare-package.ts`
  dist-package.json rewriter — tsup emits cjs+esm+`.d.ts` from one config and
  handles `exports` map generation, removing ~50 lines of bespoke publish
  scripting.
- Double check the `redis` dependency is pinned to the version you actually
  intend (`^6.0.0` in `package.json:41`) — worth confirming against what's
  actually current on npm before the rewrite locks it in.

## Suggested next step

If this direction looks right, I'd treat it as a `2.0.0` (breaking API
changes: `useClient` → `getClient`, flattened `redis`/`logger` config,
dropped `logs()`/`Logger`). I can implement this incrementally — hub
internals + logger injection first (since that's the part you explicitly
asked to replace), then the test suite, then the tooling cleanup — happy to
start whenever you say go.
