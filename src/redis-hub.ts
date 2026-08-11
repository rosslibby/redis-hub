import crypto from 'crypto';
import { createClient, RedisClientOptions } from 'redis';
import { resolveZeroConfig } from './config';
import { ClientHandle } from './handle';
import { childLogger, resolveLogger } from './logger';
import {
  ClientConfig,
  ClientState,
  DisconnectOptions,
  HubConfig,
  HubLogger,
  RedisClient,
} from './types';

const GLOBAL_KEY = Symbol.for('notross.redis-hub');
const DEFAULT_DISCONNECT_TIMEOUT_MS = 5000;

const IDLE_STATE: ClientState = { status: 'idle', lastError: null, connectedAt: null };

/**
 * Central hub managing named Redis clients. Each name gets one shared,
 * lazily-connected client. Pub/sub roles or per-namespace/user connections
 * are just distinct names.
 *
 * Every instance method is mirrored as a static that proxies to one
 * `globalThis`-guarded shared instance, so `RedisHub.getClient(...)` works
 * from any file with no `hub` variable to thread around. `new RedisHub(...)`
 * remains available for an explicitly isolated hub (tests, multi-tenant use).
 */
export class RedisHub {
  public readonly hubId: string = crypto.randomUUID();

  private hubConfig: HubConfig = {};
  private logger: HubLogger;
  private clients = new Map<string, RedisClient>();
  private clientOptions = new Map<string, RedisClientOptions>();
  private clientStates = new Map<string, ClientState>();
  private zeroConfigPromise: Promise<void> | null = null;
  private shutdownHooked = false;

  constructor(config?: HubConfig) {
    this.logger = resolveLogger(config?.logger);
    if (config) {
      this.config(config);
    }
  }

  private static get shared(): RedisHub {
    const registry = globalThis as Record<symbol, RedisHub | undefined>;
    if (!registry[GLOBAL_KEY]) {
      registry[GLOBAL_KEY] = new RedisHub();
    }
    return registry[GLOBAL_KEY] as RedisHub;
  }

  static config(config: HubConfig): void {
    RedisHub.shared.config(config);
  }

  static getClient(clientId: string, options?: ClientConfig): Promise<RedisClient> {
    return RedisHub.shared.getClient(clientId, options);
  }

  static getClientState(clientId: string): ClientState {
    return RedisHub.shared.getClientState(clientId);
  }

  static disconnect(clientId: string, options?: DisconnectOptions): Promise<void> {
    return RedisHub.shared.disconnect(clientId, options);
  }

  static disconnectAll(options?: DisconnectOptions): Promise<void> {
    return RedisHub.shared.disconnectAll(options);
  }

  static handle(clientId: string, options?: ClientConfig): ClientHandle {
    return RedisHub.shared.handle(clientId, options);
  }

  /**
   * Sets hub-wide defaults: connection options, logger, shutdown hooking.
   * Optional — call it once at startup, or don't call it at all and let
   * zero-config resolution (env vars / a discovered config file) take over.
   */
  public config(config: HubConfig): void {
    if (config.redis !== undefined) {
      this.hubConfig.redis = config.redis;
    }
    if (config.logger !== undefined) {
      this.hubConfig.logger = config.logger;
      this.logger = resolveLogger(config.logger);
    }
    if (config.autoShutdown !== undefined) {
      this.hubConfig.autoShutdown = config.autoShutdown;
    }
    if (config.defaultClientName) {
      this.hubConfig.defaultClientName = config.defaultClientName;
    }
    if (config.onOptionsConflict) {
      this.hubConfig.onOptionsConflict = config.onOptionsConflict;
    }
    if (this.hubConfig.autoShutdown) {
      this.hookShutdown();
    }
  }

  /**
   * Get or create a named Redis client. Lazy-connects on first call; the
   * same name always returns the same connected client.
   */
  public async getClient(clientId: string, options?: ClientConfig): Promise<RedisClient> {
    const existing = this.clients.get(clientId);
    if (existing) {
      if (options?.redis && this.hasConflictingOptions(clientId, options.redis)) {
        this.handleOptionsConflict(clientId);
      }
      return existing;
    }

    const redisOptions = options?.redis ?? (await this.resolveDefaultRedisOptions());
    return this.createClient(clientId, redisOptions);
  }

  public getClientState(clientId: string): ClientState {
    return this.clientStates.get(clientId) ?? IDLE_STATE;
  }

  /** Returns a bound handle for one named client — see ClientHandle. */
  public handle(clientId: string, options?: ClientConfig): ClientHandle {
    return new ClientHandle(this, clientId, options);
  }

  /** Gracefully quit()s one client (falling back to a hard destroy on timeout) and forgets it. */
  public async disconnect(clientId: string, options?: DisconnectOptions): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }
    await this.quitClient(client, options);
    this.clients.delete(clientId);
    this.clientOptions.delete(clientId);
  }

  /** Disconnects every managed client and clears internal state. */
  public async disconnectAll(options?: DisconnectOptions): Promise<void> {
    await Promise.all([...this.clients.keys()].map((clientId) => this.disconnect(clientId, options)));
  }

  private async createClient(clientId: string, redisOptions: RedisClientOptions): Promise<RedisClient> {
    const client = createClient({ ...redisOptions, name: clientId }) as RedisClient;
    this.clientOptions.set(clientId, redisOptions);
    this.setState(clientId, { status: 'connecting', lastError: null, connectedAt: null });
    this.bindClientEvents(client, clientId);
    this.clients.set(clientId, client);
    await client.connect();
    return client;
  }

  private bindClientEvents(client: RedisClient, clientId: string): void {
    const log = childLogger(this.logger, { client: clientId });

    client.on('connect', () => {
      this.setState(clientId, { ...this.getClientState(clientId), status: 'connecting' });
      log.info('client connecting');
    });
    client.on('ready', () => {
      this.setState(clientId, { status: 'ready', lastError: null, connectedAt: Date.now() });
      log.info('client ready');
    });
    client.on('reconnecting', () => {
      this.setState(clientId, { ...this.getClientState(clientId), status: 'reconnecting' });
      log.warn('client reconnecting');
    });
    client.on('end', () => {
      const { lastError } = this.getClientState(clientId);
      this.setState(clientId, { status: 'ended', lastError, connectedAt: null });
      this.clients.delete(clientId);
      this.clientOptions.delete(clientId);
      log.info('client closed');
    });
    client.on('error', (err: Error) => {
      this.setState(clientId, { ...this.getClientState(clientId), status: 'error', lastError: err });
      log.error({ err }, 'client error');
    });
  }

  private setState(clientId: string, state: ClientState): void {
    this.clientStates.set(clientId, state);
  }

  private hasConflictingOptions(clientId: string, redisOptions: RedisClientOptions): boolean {
    return JSON.stringify(this.clientOptions.get(clientId)) !== JSON.stringify(redisOptions);
  }

  private handleOptionsConflict(clientId: string): void {
    const mode = this.hubConfig.onOptionsConflict ?? 'warn';
    const message = `redis-hub: conflicting options passed for existing client "${clientId}"; the original connection options are still in effect.`;
    if (mode === 'throw') {
      throw new Error(message);
    }
    if (mode === 'warn') {
      this.logger.warn({ clientId }, message);
    }
  }

  private async resolveDefaultRedisOptions(): Promise<RedisClientOptions> {
    if (!this.hubConfig.redis) {
      await this.ensureZeroConfig();
    }
    if (!this.hubConfig.redis) {
      throw new Error(
        'redis-hub: no connection options available. Call RedisHub.config({ redis: {...} }), ' +
          'set REDIS_URL/REDIS_HUB_URL, or add a redis-hub config file.',
      );
    }
    return this.hubConfig.redis;
  }

  private async ensureZeroConfig(): Promise<void> {
    if (!this.zeroConfigPromise) {
      this.zeroConfigPromise = resolveZeroConfig(this.logger).then((resolved) => {
        this.config(resolved);
      });
    }
    return this.zeroConfigPromise;
  }

  private async quitClient(client: RedisClient, options?: DisconnectOptions): Promise<void> {
    if (options?.force) {
      await client.destroy();
      return;
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const outcome = await Promise.race([client.quit().then(() => 'quit' as const), timeout]);
    clearTimeout(timer!);

    if (outcome === 'timeout') {
      await client.destroy();
    }
  }

  private hookShutdown(): void {
    if (this.shutdownHooked) {
      return;
    }
    this.shutdownHooked = true;
    const shutdown = () => {
      this.disconnectAll().catch((err) => this.logger.error({ err }, 'redis-hub: error during autoShutdown disconnect'));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
}
