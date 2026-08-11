# @notross/redis-hub
[<img src="https://img.shields.io/npm/v/@notross/redis-hub" />](https://npmjs.com/package/@notross/redis-hub)

A minimal, zero-config connection hub for Redis in Node.js: **lazily creates and
reuses named Redis clients** (e.g. `publisher`, `subscriber`, per-user,
per-namespace) with centralized config, per-client state, and pluggable
structured logging.

## Features
- Zero-config by default — set `REDIS_URL` and just start calling `RedisHub.getClient(...)`, no setup file required
- Named, lazily-created, shared clients — same name always returns the same connected client
- No `hub` variable to export/import across files — `RedisHub`'s static methods route to one shared instance
- Per-client state tracking (`ready`, `reconnecting`, `error`, ...), not hub-global mutable fields
- Pluggable structured logging — bring your own [pino](https://github.com/pinojs/pino) instance (or anything pino-shaped), or use the bundled default
- Graceful shutdown — `quit()`-based disconnects, with an opt-in `autoShutdown` that hooks `SIGTERM`/`SIGINT`

## Installation
```bash
npm install @notross/redis-hub
# or
yarn add @notross/redis-hub
```

## Quick Start

The fastest path — no setup file, no `config()` call. Set `REDIS_URL` (already
set for you on Heroku/Railway/Render/Fly) and go:

```ts
// publisher.ts
import { RedisHub } from '@notross/redis-hub';

const pub = await RedisHub.getClient('publisher');
await pub.publish('chat', 'hello world');
```

```ts
// subscriber.ts — separate file, same package, no shared variable needed
import { RedisHub } from '@notross/redis-hub';

const sub = await RedisHub.getClient('subscriber');
await sub.subscribe('chat', (message) => console.log('received:', message));
```

Redis pub/sub requires separate connections for publishing and subscribing —
that's exactly what named clients are for.

### Explicit config

If you want to set connection options, inject a logger, or turn on graceful
shutdown, call `RedisHub.config(...)` once at startup:

```ts
import { RedisHub } from '@notross/redis-hub';
import pino from 'pino';

RedisHub.config({
  redis: { url: process.env.REDIS_URL },
  logger: pino({ level: 'info' }),
  autoShutdown: true,
});
```

## Per-client handles

For a file that owns exactly one named client, `RedisHub.handle(name)` bundles
that client's operations together so the name isn't repeated at every call
site:

```ts
import { RedisHub } from '@notross/redis-hub';

const publisher = RedisHub.handle('publisher');

export async function publish(channel: string, message: string) {
  const client = await publisher.client; // memoized — only connects once
  await client.publish(channel, message);
}

publisher.getState();      // => { status: 'ready', lastError: null, connectedAt: ... }
await publisher.disconnect();
```

`RedisHub.handle(...)` returns synchronously and doesn't connect anything
itself — `.client` is a memoized promise that connects lazily on first access.

## Zero-config resolution

If `RedisHub.config(...)` is never called, the first `getClient()` call
resolves connection defaults, once, in this order:

1. **`REDIS_HUB_URL`** — a namespaced override, useful if this package should
   point somewhere different than a generic `REDIS_URL` another library in
   the same process might also read.
2. **`REDIS_URL`** — the convention already set by most hosting platforms.
3. **A config file**, resolved via [`cosmiconfig`](https://github.com/cosmiconfig/cosmiconfig)
   (the same resolver ESLint/Prettier/Stylelint use) — a `redis-hub` key in
   `package.json`, `.redis-hubrc(.json|.yaml|.yml|.js|.cjs|.mjs)`, or
   `redis-hub.config.(js|cjs|mjs|json)`. JS/CJS/MJS files can export the exact
   same shape as `RedisHub.config({...})` (functions included — a real
   `logger` instance, a custom `onOptionsConflict` handler); JSON/YAML files
   are limited to plain data.

   ```json
   // redis-hub.config.json
   { "redis": { "url": "redis://localhost:6379" } }
   ```

   A bare `{ "url": "redis://..." }` (no `redis` wrapper key) also works.
4. **`redis://localhost:6379`** — last-resort default for local dev.

Whichever source wins is logged once at `debug` level, so this stays legible
rather than feeling like silent magic in production. An explicit
`RedisHub.config(...)` call, or options passed directly to `getClient(name,
options)`, always override the above.

**`.env` files aren't this package's concern.** `.env` support is just "is
`REDIS_URL` already in `process.env`," which `dotenv` (or your platform)
populates *before* this package runs. Add `dotenv`/`import 'dotenv/config'`
yourself, upstream of anything that touches `RedisHub` — a library reaching
into `.env` loading on your behalf would fight whatever env strategy your app
already has.

## Logging

Inject any pino instance, a pino child logger, or anything satisfying the
same four-method shape:

```ts
import { RedisHub, type HubLogger } from '@notross/redis-hub';
import pino from 'pino';

RedisHub.config({ logger: pino() });          // a real pino instance
RedisHub.config({ logger: myWinstonAdapter }); // anything HubLogger-shaped
RedisHub.config({ logger: false });            // disable logging entirely
```

```ts
type HubLogger = {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
};
```

If nothing is injected, a plain-JSON pino instance is used by default. For
colorized local dev output, pipe stdout through `pino-pretty` yourself
(pino's own recommended pattern, not something this package does for you):
```bash
node app.js | npx pino-pretty
```

## API

### `RedisHub.config(config: HubConfig): void`
Sets hub-wide defaults. Optional — see [Zero-config resolution](#zero-config-resolution).
```ts
RedisHub.config({
  redis: { url: 'redis://localhost:6379' },
  logger: pino(),
  autoShutdown: true,
  onOptionsConflict: 'warn', // 'throw' | 'warn' | 'ignore', default 'warn'
});
```

### `RedisHub.getClient(clientId: string, options?: ClientConfig): Promise<RedisClient>`
Get or create a named client. Lazy-connects on first call. Same `clientId`
always returns the same connected client; per-client `options.redis` only
applies on first creation. Passing different options for an existing client
follows `onOptionsConflict`.

### `RedisHub.getClientState(clientId: string): ClientState`
```ts
RedisHub.getClientState('publisher');
// => { status: 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'ended' | 'error', lastError: Error | null, connectedAt: number | null }
```

### `RedisHub.handle(clientId: string, options?: ClientConfig): ClientHandle`
Returns `{ client, getState(), disconnect() }` bound to one client — see
[Per-client handles](#per-client-handles).

### `RedisHub.disconnect(clientId: string, options?: DisconnectOptions): Promise<void>`
Gracefully `quit()`s one client (draining in-flight commands), falling back to
a hard `destroy()` after `options.timeoutMs` (default 5000ms). Pass
`{ force: true }` to skip straight to `destroy()`.

### `RedisHub.disconnectAll(options?: DisconnectOptions): Promise<void>`
Same as above, for every managed client.

### `new RedisHub(config?: HubConfig)`
An explicitly isolated hub — a second Redis endpoint, test isolation, a
multi-tenant process. Has the exact same instance methods as the statics
above; `RedisHub.getClient(...)` is just `RedisHub`'s shared instance calling
`.getClient(...)` on itself.

## Graceful shutdown

```ts
RedisHub.config({ autoShutdown: true });
```
Hooks `SIGTERM`/`SIGINT` to call `disconnectAll()` before the process exits.
Without it, call `RedisHub.disconnectAll()` yourself on shutdown.

## Per-user / namespaced clients

Named clients aren't limited to pub/sub roles:
```ts
async function getUserClient(userId: string) {
  return RedisHub.getClient(`user-${userId}`);
}

const user123 = await getUserClient('123');
await user123.set('lastLogin', Date.now());
```

---
## License
MIT © [@notross](https://rosslibby.com)
