# @notross/redis-hub

A minimal connection hub for Redis in Node.js: **lazily creates and reuses named Redis clients** (e.g., `publisher`, `subscriber`, per-user, per-namespace) with centralized config and event tracking.

## Features
- Single shared hub in your runtime (safe for multiple imports)
- Lazy instantiation: redisClient('publisher') creates on demand
- Event logging: ready, reconnecting, error, etc.
- Pub/Sub friendly: separate clients by role to avoid cross-use
- Single source of config (URI/options via defaults or per-client)

## Installation
```bash
# NPM
npm install @notross/redis-hub

# Yarn
yarn add @notross/redis-hub
```

## Quick Start

```ts
// redis.ts
import redisHub, { redisClient } from '@notross/redis-hub';

// Set global default options (optional)
redisHub.setDefaultOptions({
  url: process.env.REDIS_URL,
});

// Publisher
const pub = await redisClient('publisher');
await pub.publish('my-channel', 'hello world');

// Subscriber
const sub = await redisClient('subscriber');
await sub.subscribe('my-channel', (message) => {
  console.log('Got message:', message);
});

```

## API

`redisClient(clientId: string, options?: RedisClientOptions): Promise<RedisClient>`

Get or create a named Redis client.

- `clientId` — Logical name (e.g., `"publisher"`, `"user-123"`)
- `options` — Optional `RedisClientOptions` (only applied on first creation)

💡 Tip: Same clientId always returns the same connected client.

`redisHub.setDefaultOptions(options: RedisClientOptions): void`

Sets default Redis connection options, used when no per-client options are provided.
```typescript
redisHub.setDefaultOptions({
  url: 'redis://localhost:6379'
});
```

`redisHub.getClientById(clientId: string): RedisClient | null`

Returns an existing connected client by ID (without creating it).
```typescript
const pub = redisHub.getClientById('publisher');
```

`redisHub.disconnectAll(): Promise<void>`

Disconnects all active Redis clients and clears the hub.
```typescript
await redisHub.disconnectAll();
```

`redisHub.logs(): LogResult[]`

Returns captured log entries (useful when logging is disabled).
```typescript
const logs = redisHub.logs();
```

## Event Logging
Every client automatically logs lifecycle events:

- `connect`
- `ready`
- `reconnecting`
- `end`
- `error`

You can disable or configure logging:
```typescript
import { RedisHub } from '@notross/redis-hub';
const hub = new RedisHub({ logs: false });
```

## Pub/Sub Best Practices
Because Redis doesn’t allow a single connection to both publish and subscribe without blocking, use distinct logical names:
```typescript
const pub = await redisClient('publisher');
const sub = await redisClient('subscriber');

await sub.subscribe('chat', (msg) => console.log('Got', msg));
await pub.publish('chat', 'Hello!');
```

## Config via Environment
Typical usage is to set REDIS_URL or REDIS_URI and apply it as default options:
```typescript
redisHub.setDefaultOptions({
  url: process.env.REDIS_URL,
});
```

## Example: Per-User Namespaced Clients
```typescript
async function getUserClient(userId: string) {
  return redisClient(`user-${userId}`, {
    url: process.env.REDIS_URL
  });
}

const user123Client = await getUserClient('123');
await user123Client.set('lastLogin', Date.now());
```
---
## License
MIT © [@notross](https://rosslibby.com)
