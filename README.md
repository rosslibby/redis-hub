# @notross/redis-hub

[<img src="https://img.shields.io/npm/v/@notross/redis-hub" />](https://npmjs.com/package/@notross/redis-hub)

> **Zero-config, lazy connection hub for Redis in Node.js.** Lazily creates and reuses named Redis clients (`publisher`, `subscriber`, per-tenant, per-worker) with centralized configuration, per-client state tracking, and pluggable structured logging.

---

## Features

- ⚡ **Zero-Config Defaults**: Point to `REDIS_URL` or `REDIS_HUB_URL` and query instantly with zero boilerplate required.
- 🔀 **Named & Lazily Created Clients**: Identical client IDs resolve to the same memoized, connected Redis instance across your entire application.
- 📦 **No Export Boilerplate**: Use `RedisHub` static methods anywhere in your codebase without exporting shared instances across files.
- 📊 **Per-Client State Tracking**: Track individual status (`ready`, `reconnecting`, `error`) on a per-client basis rather than global mutable state.
- 🪵 **Pluggable Structured Logging**: Inject your own [Pino](https://getpino.io) logger instance or use sensible zero-config defaults.
- 🛑 **Graceful Shutdown**: Drains in-flight commands using graceful `quit()` disconnects with opt-in `SIGTERM`/`SIGINT` process hooks.

---

## Installation

```bash
npm install @notross/redis-hub
# or
yarn add @notross/redis-hub
```

---

## Quick Start

Set `REDIS_URL` (or rely on platform environment variables on Heroku, Railway, Render, Fly, etc.) and call `RedisHub.getClient(...)` directly:

```ts
// publisher.ts
import { RedisHub } from '@notross/redis-hub';

const pub = await RedisHub.getClient('publisher');
await pub.publish('chat', 'hello world');
```

```ts
// subscriber.ts — separate file, same package, zero shared variable exports
import { RedisHub } from '@notross/redis-hub';

const sub = await RedisHub.getClient('subscriber');
await sub.subscribe('chat', (message) => {
  console.log('Received:', message);
});
```

> **Why Named Clients?** Redis Pub/Sub requires dedicated connections for publishing and subscribing—named clients manage this lifecycle automatically.

---

### Programmatic Configuration

To set global connection options, inject a logger, or enable automatic graceful shutdown hooks, call `RedisHub.config(...)` once at application boot:

```ts
import { RedisHub } from '@notross/redis-hub';
import pino from 'pino';

RedisHub.config({
  redis: { url: process.env.REDIS_URL },
  logger: pino({ level: 'info' }),
  autoShutdown: true,
});
```

---

## Per-Client Handles

For modules that own a specific named client, use `RedisHub.handle('name')` to encapsulate operations without repeating the client ID at every call site:

```ts
import { RedisHub } from '@notross/redis-hub';

const publisher = RedisHub.handle('publisher');

export async function publish(channel: string, message: string) {
  const client = await publisher.client; // Memoized — connects lazily on first access
  await client.publish(channel, message);
}

// Inspect status or disconnect independently
publisher.getState(); // => { status: 'ready', lastError: null, connectedAt: 1700000000000 }
await publisher.disconnect();
```

`RedisHub.handle(...)` returns synchronously without triggering an immediate network call. The internal `.client` property is a memoized promise that connects lazily on first access.

---

## Configuration Precedence

If `RedisHub.config(...)` is not called explicitly, the first `getClient()` access automatically resolves configuration settings in the following order (**highest priority wins**):

1. **`REDIS_HUB_URL`** — Package-specific environment variable override.
2. **`REDIS_URL`** — Standard environment variable set by hosting platforms.
3. **Config File** — Resolved via [`cosmiconfig`](https://github.com/cosmiconfig/cosmiconfig):
   * `redis-hub` key in `package.json`
   * `.redis-hubrc` (`.json`, `.yaml`, `.yml`, `.js`, `.cjs`, `.mjs`)
   * `redis-hub.config.js` (`.cjs`, `.mjs`, `.json`)
4. **Local Fallback** — `redis://localhost:6379` (used strictly as a last resort for local development).

```json
// redis-hub.config.json
{
  "redis": {
    "url": "redis://localhost:6379"
  }
}
```

> **Environment File Notice**: `.env` files should be loaded upstream by your application runtime (e.g., via `dotenv` or framework runners) before initializing `RedisHub`.

---

## Logging

Inject any Pino instance, Pino child logger, or custom logger adhering to the `HubLogger` interface:

```ts
import { RedisHub, type HubLogger } from '@notross/redis-hub';
import pino from 'pino';

RedisHub.config({ logger: pino() });           // Standard Pino instance
RedisHub.config({ logger: myWinstonAdapter }); // Custom HubLogger adapter
RedisHub.config({ logger: false });            // Disable logging entirely
```

```ts
type HubLogger = {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
};
```

---

## Graceful Shutdown

Enable automatic process termination handling to drain active commands before exit:

```ts
import { RedisHub } from '@notross/redis-hub';

RedisHub.config({ autoShutdown: true });
```

This hooks `SIGTERM` and `SIGINT` signals to execute `disconnectAll()` gracefully before process termination.

---

## API Reference

### `RedisHub.config(config: HubConfig): void`
Sets global hub options.

```ts
RedisHub.config({
  redis: { url: 'redis://localhost:6379' },
  logger: pino(),
  autoShutdown: true,
  onOptionsConflict: 'warn', // 'throw' | 'warn' | 'ignore'
});
```

### `RedisHub.getClient(clientId: string, options?: ClientConfig): Promise<RedisClient>`
Retrieves or lazily instantiates a named Redis client instance.

### `RedisHub.getClientState(clientId: string): ClientState`
Returns runtime status for a specific client ID (`'idle' | 'connecting' | 'ready' | 'reconnecting' | 'ended' | 'error'`).

### `RedisHub.handle(clientId: string, options?: ClientConfig): ClientHandle`
Returns a `{ client, getState(), disconnect() }` handle bound to a single named client.

### `RedisHub.disconnect(clientId: string, options?: DisconnectOptions): Promise<void>`
Gracefully disconnects a single client using `quit()`, falling back to `destroy()` after `timeoutMs` (default: `5000ms`).

### `RedisHub.disconnectAll(options?: DisconnectOptions): Promise<void>`
Gracefully disconnects all managed clients across the hub.

### `new RedisHub(config?: HubConfig)`
Instantiates an isolated hub instance for testing or multi-tenant architectures requiring distinct configurations.

---

## Migrating from v1

This release introduces breaking structural and operational updates:

* **Removal of `.init()`**: Replaced by automatic resolution from environment variables or explicit `RedisHub.config(...)`.
* **Removal of `useClient`**: Deprecated in favor of `RedisHub.getClient(id, options)` or `redisHub.getClient(...)`.
* **Nested Connection Options**: Per-client Redis connection parameters must now be nested under a `redis` key.

```ts
// Legacy (v1)
import { useClient } from '@notross/redis-hub';

const publisher = await useClient('publisher', {
  pingInterval: 60000,
  socket: { keepAlive: true },
});

// Current (v2)
import { RedisHub } from '@notross/redis-hub';

const publisher = await RedisHub.getClient('publisher', {
  redis: {
    pingInterval: 60000,
    socket: { keepAlive: true },
  },
});
```

## Migrating from v1

**v2 is a breaking change.** The v1 `redisHub` singleton, `.init(...)`, and
`useClient(...)` are gone, replaced by the `RedisHub` static API described
above (`redisHub` still exists in v2, as a lowercase alias for `RedisHub`).
Two changes cover most migrations:

1. **Remove the `.init(...)` call**, if you want v2's implicit config — it
   picks up `REDIS_URL` automatically on first `getClient()` call (see
   [Zero-config resolution](#zero-config-resolution)).

   ```ts
   redisHub.init({ logging: false, url: process.env.REDIS_URL });
   ```

   If you *do* need non-default options (a custom logger, `autoShutdown`,
   a URL other than `REDIS_URL`), call `RedisHub.config(...)` once at
   startup instead — see [Explicit config](#explicit-config).

2. **Replace `useClient(...)` with `redisHub.getClient(...)`**, and move any
   redis-specific connection options for that call under a `redis` key.

   ```ts
   // before (v1)
   import { useClient } from '@notross/redis-hub';

   const publisher = await useClient('publisher', {
     pingInterval: 60000,
     socket: { keepAlive: true },
   });

   // after (v2)
   import { redisHub } from '@notross/redis-hub';

   const publisher = await redisHub.getClient('publisher', {
     redis: {
       pingInterval: 60000,
       socket: { keepAlive: true },
     },
   });
   ```

---

## Known Gotchas

### Reconnect loops against Redis Enterprise / Redis Cloud in containerized environments

`redis-hub` passes your `redis: {...}` options straight through to `createClient()`, so this is really a [`node-redis`](https://github.com/redis/node-redis) behavior to be aware of rather than anything `redis-hub` does itself — but it's easy to lose hours to, so it's worth flagging here.

As of `redis` `^6.x`, RESP3 is the default protocol, which in turn defaults `maintNotifications` to `"auto"`. That silently opts every client into Redis Enterprise/Cloud's maintenance-notification handshake (`CLIENT MAINT_NOTIFICATIONS ON`), meaning the client will honor server-pushed `MOVING` redirects to a different address during cluster maintenance/failover. To decide what kind of address to request (`internal-ip`, `external-fqdn`, etc.), node-redis DNS-resolves your Redis host and classifies it private vs. public — a classification that can differ by network context (e.g., a Docker container's DNS/routing vs. your host machine's).

If you see clients connect fine in one environment but immediately enter a reconnect loop and crash in another — most commonly: works from a local terminal, fails inside Docker — with the *same* connection URL, this is the first thing to check, not a config or credentials problem.

**To confirm**: set `REDIS_DEBUG_MAINTENANCE=1` and `REDIS_EMIT_DIAGNOSTICS=1` in the failing environment. If a `MOVING`/`MIGRATING` push notification logs right before the crash loop starts, this is it.

**To fix**, disable it explicitly (or pin the endpoint type instead of leaving it on `'auto'`):

```ts
RedisHub.config({
  redis: {
    url: process.env.REDIS_URL,
    maintNotifications: 'disabled',
    // — or, to keep the feature but stop it from guessing —
    // maintEndpointType: 'external-ip',
  },
});
```

---

## License

MIT © [Ross Libby](https://rosslibby.com)