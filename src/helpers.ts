import { ClientOptions, RedisClient } from './types';
import { RedisHub } from './redis-hub';
import SharedHub from './shared';

function useClient(name: string, options?: ClientOptions): Promise<RedisClient> {
  if (typeof options !== 'undefined') {
    return (new RedisHub().client(name, options));
  }
  return SharedHub.client(name);
}

export { useClient };
