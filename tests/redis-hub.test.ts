import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RedisHub } from '../src';

const SHARED_HUB_KEY = Symbol.for('notross.redis-hub');

async function resetSharedHub(): Promise<void> {
  const registry = globalThis as Record<symbol, RedisHub | undefined>;
  const existing = registry[SHARED_HUB_KEY];
  if (existing) {
    await existing.disconnectAll({ force: true }).catch(() => {});
  }
  delete registry[SHARED_HUB_KEY];
}

let container: StartedRedisContainer;
let redisUrl: string;

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start();
  redisUrl = container.getConnectionUrl();
}, 60000);

afterAll(async () => {
  await container.stop();
});

afterEach(async () => {
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HUB_URL;
  await resetSharedHub();
});

describe('RedisHub instance', () => {
  it('reuses the same client for the same name', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    const a = await hub.getClient('a');
    const b = await hub.getClient('a');
    expect(a).toBe(b);
    await hub.disconnectAll();
  });

  it('merges a per-client redis override onto the resolved default connection, instead of replacing it', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    // No `url`/connection details here on purpose — this must not drop the
    // hub's default connection and fall back to node-redis's own defaults
    // (which would try to connect to localhost:6379).
    const client = await hub.getClient('override-only', { redis: { database: 0 } });
    expect(hub.getClientState('override-only').status).toBe('ready');
    await hub.disconnectAll();
    expect(client).toBeDefined();
  });

  it('lets a per-client redis override tweak one field while keeping the resolved default connection', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    await hub.getClient('override-field', { redis: { database: 1 } });
    expect(hub.getClientState('override-field').status).toBe('ready');
    await hub.disconnectAll();
  });

  it('tracks per-client state independently, not as hub-global mutable fields', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    await hub.getClient('pub');
    await hub.getClient('sub');
    expect(hub.getClientState('pub').status).toBe('ready');
    expect(hub.getClientState('sub').status).toBe('ready');
    expect(hub.getClientState('never-requested').status).toBe('idle');
    await hub.disconnectAll();
  });

  it('warns (default) on conflicting options for an existing client and keeps the original connection', async () => {
    const warnings: unknown[] = [];
    const logger = {
      debug() {},
      info() {},
      warn: (...args: unknown[]) => warnings.push(args),
      error() {},
    };
    const hub = new RedisHub({ redis: { url: redisUrl }, logger });
    const original = await hub.getClient('x');
    const again = await hub.getClient('x', { redis: { url: redisUrl, database: 1 } });
    expect(again).toBe(original);
    expect(warnings.length).toBe(1);
    await hub.disconnectAll();
  });

  it('throws on conflicting options when onOptionsConflict is "throw"', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false, onOptionsConflict: 'throw' });
    await hub.getClient('y');
    await expect(hub.getClient('y', { redis: { url: redisUrl, database: 2 } })).rejects.toThrow();
    await hub.disconnectAll();
  });

  it('disconnect() gracefully quits and forgets the client; a later request reconnects', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    await hub.getClient('z');
    await hub.disconnect('z');
    expect(hub.getClientState('z').status).toBe('ended');

    await hub.getClient('z');
    expect(hub.getClientState('z').status).toBe('ready');
    await hub.disconnectAll();
  });

  it('disconnect({ force: true }) works without a graceful quit round-trip', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    await hub.getClient('force-me');
    await expect(hub.disconnect('force-me', { force: true })).resolves.toBeUndefined();
  });
});

describe('RedisHub statics (shared singleton)', () => {
  it('routes through one shared hub, no per-file variable required', async () => {
    RedisHub.config({ redis: { url: redisUrl }, logger: false });
    const a = await RedisHub.getClient('shared-a');
    const b = await RedisHub.getClient('shared-a');
    expect(a).toBe(b);
    await RedisHub.disconnectAll();
  });
});

describe('zero-config resolution', () => {
  it('falls back to REDIS_URL when config() was never called', async () => {
    process.env.REDIS_URL = redisUrl;
    await RedisHub.getClient('env-client');
    expect(RedisHub.getClientState('env-client').status).toBe('ready');
    await RedisHub.disconnectAll();
  });

  it('REDIS_HUB_URL takes precedence over REDIS_URL', async () => {
    process.env.REDIS_URL = 'redis://this-host-does-not-exist.invalid:6379';
    process.env.REDIS_HUB_URL = redisUrl;
    await RedisHub.getClient('hub-url-client');
    expect(RedisHub.getClientState('hub-url-client').status).toBe('ready');
    await RedisHub.disconnectAll();
  });
});

describe('ClientHandle', () => {
  it('memoizes the client promise, proxies state/disconnect, and reconnects after disconnect', async () => {
    RedisHub.config({ redis: { url: redisUrl }, logger: false });
    const publisher = RedisHub.handle('publisher-handle');

    const first = await publisher.client;
    const second = await publisher.client;
    expect(second).toBe(first);
    expect(publisher.getState().status).toBe('ready');

    await publisher.disconnect();
    expect(publisher.getState().status).toBe('ended');

    const third = await publisher.client;
    expect(third).not.toBe(first);
    expect(publisher.getState().status).toBe('ready');

    await RedisHub.disconnectAll();
  });
});

describe('pub/sub', () => {
  it('publishes and receives messages across separate named clients', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    const pub = await hub.getClient('ps-pub');
    const sub = await hub.getClient('ps-sub');

    let resolveMessage: (message: string) => void;
    const messageReceived = new Promise<string>((resolve) => {
      resolveMessage = resolve;
    });

    await sub.subscribe('chat', (message) => resolveMessage(message));
    await pub.publish('chat', 'hello-world');

    await expect(messageReceived).resolves.toBe('hello-world');
    await hub.disconnectAll();
  });
});

describe('logger injection', () => {
  it('accepts any object satisfying the debug/info/warn/error shape', async () => {
    const calls: string[] = [];
    const logger = {
      debug: () => calls.push('debug'),
      info: () => calls.push('info'),
      warn: () => calls.push('warn'),
      error: () => calls.push('error'),
    };
    const hub = new RedisHub({ redis: { url: redisUrl }, logger });
    await hub.getClient('logged');
    expect(calls).toContain('info');
    await hub.disconnectAll();
  });

  it('logger: false silences everything with no throw', async () => {
    const hub = new RedisHub({ redis: { url: redisUrl }, logger: false });
    await expect(hub.getClient('silent')).resolves.toBeDefined();
    await hub.disconnectAll();
  });
});
