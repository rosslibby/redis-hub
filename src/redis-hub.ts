import { createClient, RedisClientOptions } from 'redis';
import { RedisClient, LoggerConfig, LogResult } from './types';
import { Logger } from './utils';

const logger = new Logger();

/**
 * Central hub managing named Redis clients. Each
 * name gets one shared connection.
 * 
 * Pub/sub roles or per-namespace/user connections
 * are just distinct names.
 */
export class RedisHub {
  private defaultClientName: string = 'default';
  private clients: Record<string, RedisClient> = {};
  private clientOptions: Record<string, RedisClientOptions> = {};
  private defaultOptions: RedisClientOptions | undefined = {};
  public error: any | null = null;
  public status: string | null = null;
  public connect: (
    clientId: string,
  ) => Promise<RedisClient> = this.client.bind(this);

  constructor(loggerConfig?: LoggerConfig) {
    this.configureLogger(loggerConfig);
  }

  public configureLogger(config: LoggerConfig = { logs: true }): void {
    logger.setup(config);
  }

  public async getDefaultClient(): Promise<RedisClient> {
    return await this.client(this.defaultClientName);
  }

  private setDefaultOptions(options: RedisClientOptions): void {
    this.defaultOptions = options;
  }

  /**
   * Set the global default Redis options used when no per-client override exists.
   * @param options RedisClientOptions
   * @param options.defaultClientName string
   */
  public init(options: RedisClientOptions & {
    defaultClientName?: string;
  }): void {
    const { defaultClientName, ...redisClientOptions } = options;

    this.setDefaultOptions(redisClientOptions);

    if (defaultClientName) {
      this.defaultClientName = defaultClientName;
    }
  }

  public getClientById(clientId: string): RedisClient | null {
    return this.clients[clientId] ?? null;
  }

  private createClient(
    clientId: string,
    options?: RedisClientOptions,
  ): RedisClient {
    options = options ?? this.defaultOptions;
    if (!options) {
      throw new Error(
        `No options provided for '${clientId}' and no default options exist.`
      );
    }
    const client = createClient(options);
    this.handleClientEvents(client, clientId);
    this.clients[clientId] = client;
    this.clientOptions[clientId] = options;
    return client;
  }

  private conflictingOptions(
    clientId: string,
    options: RedisClientOptions,
  ): boolean {
    const clientOptions = JSON.stringify(this.clientOptions[clientId]);
    return JSON.stringify(options) !== clientOptions;
  }

  /**
   * Get or create a named Redis client. Lazy-connects on first call.
   * @param clientId Logical name (e.g., "publisher", "user-123-subscriber").
   * @param options Optional per-client options; only applied on first creation.
   * @returns Connected Redis client.
   */
  public async client(
    clientId: string,
    options?: RedisClientOptions,
): Promise<RedisClient> {
    if (this.clients[clientId]) {
      if (options && this.conflictingOptions(clientId, options)) {
        logger.warn(
          `Options for '${clientId}' were passed again and ignored.`
        );
      }
      return this.clients[clientId];
    }
    const client = this.createClient(clientId, options);
    await client.connect();
    return client;
  }

  /**
   * Disconnects all managed clients and clears internal state.
   */
  public async disconnectAll(): Promise<void> {
    await Promise.all(
      Object.values(this.clients).map((client) => client.destroy())
    );
    this.clients = {};
  }

  /**
   * List all logs; useful if logging is disabled
   */
  public logs(): LogResult[] {
    return logger.logs;
  }

  private handleClientEvents(client: RedisClient, clientId: string): void {
    // Prevent double-binding: Redis client instances are
    // new per name so safe to bind unconditionally here.
    client.on('connect', () => {
      this.status = `[${clientId}]: client connected.`;
      logger.log(this.status);
      this.clients[clientId] = client;
    });
    client.on('ready', () => {
      this.status = `[${clientId}]: client ready.`;
      logger.log(this.status);
      this.clients[clientId] = client;
    });
    client.on('reconnecting', () => {
      this.status = `[${clientId}]: client reconnecting...`;
      logger.log(this.status);
      this.clients[clientId] = client;
    });
    client.on('end', () => {
      this.status = `[${clientId}]: client closed.`;
      logger.log(this.status);
      this.clients[clientId] = client;
    });
    client.on('error', (err) => {
      this.status = `[${clientId}]: client error:`
      this.error = err;
      logger.error(this.status, this.error);
      this.clients[clientId] = client;
    });
  }
}
