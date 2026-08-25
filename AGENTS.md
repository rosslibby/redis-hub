# AGENTS.md

## Project

`@notross/redis-hub` — a zero-config, lazily-connected Redis client hub for
Node.js/TypeScript. Named clients are memoized singletons shared via a
`globalThis` symbol registry (`Symbol.for('notross.redis-hub')`), so
`RedisHub.getClient(id)` returns the same connected client from any file with
no manual export/import of a shared instance. Source of truth for the public
API and usage patterns is `README.md`.

Stack: TypeScript (`strict: true`), built with `tsup` to dual ESM/CJS
(`dist/index.js` / `dist/index.cjs`), `type: "module"` at the package root.
Runtime deps: `redis` (node-redis v6+), `pino` (logging), `cosmiconfig`
(zero-config file discovery).

## Commands

- `yarn dev` — run `src/index.ts` directly via `tsx watch`
- `yarn build` — `tsup` build to `dist/`
- `yarn typecheck` — `tsc --noEmit`
- `yarn test` / `yarn test:watch` — `vitest`, uses `@testcontainers/redis` to
  spin up a real Redis for integration tests (requires Docker locally)

Always run `yarn typecheck` and `yarn test` before considering a change done.

## Code style

- Options passed to `RedisHub.getClient`/`.config`/`.handle` are always nested
  under a `redis` key (`{ redis: { url, socket, ... } }`) — never flat
  `RedisClientOptions` at the top level. This is a common v1→v2 migration
  mistake; see "Migrating from v1" in README.md.
- No default export; always `import { RedisHub } from '@notross/redis-hub'`.
- Per-client state is tracked via `ClientState` (`idle | connecting | ready |
  reconnecting | ended | error`), not ad-hoc booleans.

## Known gotchas

- **RESP3 default + maintenance-notification reconnect loops**: node-redis
  `^6.x` defaults to RESP3, which defaults `maintNotifications` to `"auto"`.
  Against Redis Enterprise/Cloud, this can cause environment-dependent
  reconnect loops (e.g. works locally, crash-loops in Docker) because the
  client's endpoint-type detection depends on DNS/network context. See
  "Known Gotchas" in README.md before assuming a connection-string or
  credentials problem. Diagnose with `REDIS_DEBUG_MAINTENANCE=1` /
  `REDIS_EMIT_DIAGNOSTICS=1`; fix with `redis: { maintNotifications:
  'disabled' }`.

## Security

No secrets belong in this repo. `.env` here is only for the local Claude Code
CLI proxy config, unrelated to Redis connection credentials.
