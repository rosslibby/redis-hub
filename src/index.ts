import { RedisHub } from './redis-hub';

// Global guard so multiple loads still share one hub in the same runtime
const GLOBAL_KEY = Symbol.for('notross.redis-hub');

function getSharedHub(): RedisHub {
  // @ts-ignore
  if (!(globalThis as any)[GLOBAL_KEY]) {
    // @ts-ignore
    (globalThis as any)[GLOBAL_KEY] = new RedisHub();
  }
  // @ts-ignore
  return (globalThis as any)[GLOBAL_KEY];
}

const redisHub = getSharedHub();

export default redisHub;
export const redisClient = redisHub.client.bind(redisHub);
export const defaultClient = redisHub.getDefaultClient.bind(redisHub);
