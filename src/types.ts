import { createClient, RedisClientOptions } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

export type HubLogger = {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
};

export type OnOptionsConflict = 'throw' | 'warn' | 'ignore';

export type HubConfig = {
  /** Default connection options used when a client is requested with no per-client override. */
  redis?: RedisClientOptions;
  /** Any pino-shaped logger (debug/info/warn/error), or `false` to disable logging entirely. */
  logger?: HubLogger | false;
  /** Hook SIGTERM/SIGINT to gracefully disconnect all clients on shutdown. */
  autoShutdown?: boolean;
  /** Logical name used by clients that don't specify one of their own. */
  defaultClientName?: string;
  /** What to do when a client already exists and is requested again with different options. */
  onOptionsConflict?: OnOptionsConflict;
};

export type ClientConfig = {
  redis?: RedisClientOptions;
};

export type ClientStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'ended'
  | 'error';

export type ClientState = {
  status: ClientStatus;
  lastError: Error | null;
  connectedAt: number | null;
};

export type DisconnectOptions = {
  /** Skip the graceful quit() and kill the socket immediately. */
  force?: boolean;
  /** How long to wait for quit() to finish before forcing a hard destroy. Defaults to 5000ms. */
  timeoutMs?: number;
};
