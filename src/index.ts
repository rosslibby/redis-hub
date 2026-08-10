import { RedisHub } from './redis-hub';

/** Convenience alias for the shared hub instance — identical to using `RedisHub`'s statics. */
const redisHub = RedisHub;

export { RedisHub, redisHub };
export type {
  ClientConfig,
  ClientState,
  ClientStatus,
  DisconnectOptions,
  HubConfig,
  HubLogger,
  OnOptionsConflict,
  RedisClient,
} from './types';
export type { ClientHandle } from './handle';
