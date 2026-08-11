import type { RedisHub } from './redis-hub';
import { ClientConfig, ClientState, DisconnectOptions, RedisClient } from './types';

/**
 * A bound scope over one named client, for the common case of a file that
 * owns exactly one of them. Returned synchronously — nothing connects until
 * `.client` is first accessed.
 */
export class ClientHandle {
  private cachedClient: Promise<RedisClient> | null = null;

  constructor(
    private readonly hub: RedisHub,
    private readonly clientId: string,
    private readonly options?: ClientConfig,
  ) {}

  /** Memoized: the first access triggers the real connection, later accesses reuse it. */
  get client(): Promise<RedisClient> {
    if (!this.cachedClient) {
      this.cachedClient = this.hub.getClient(this.clientId, this.options);
    }
    return this.cachedClient;
  }

  getState(): ClientState {
    return this.hub.getClientState(this.clientId);
  }

  async disconnect(options?: DisconnectOptions): Promise<void> {
    await this.hub.disconnect(this.clientId, options);
    this.cachedClient = null;
  }
}
