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

---

## License

MIT © [Ross Libby](https://rosslibby.com)