# @notross/redis-hub

A minimal connection hub for Redis in Node.js:  
**lazily creates and reuses named Redis clients** (e.g., `publisher`, `subscriber`, per-user, per-namespace) with centralized config and event tracking.

## Features

- Shared clients by logical name (no duplicate connection boilerplate)  
- Lazy instantiation: `redisClient('publisher')` creates it on demand  
- Built-in event logging/hooks (ready, reconnecting, error, etc.)  
- Single source of config (URI/options via env)  
- Works cleanly for pub/sub roles without accidental cross-use

## Quick Start

```ts
// redis.ts
export { redisClient } from '@notross/redis-hub';