import { ClientOptions } from './types';
import { RedisHub } from './redis-hub';

export const useClient = (
  name: string,
  options?: ClientOptions,
) => (new RedisHub()).client(name, options);
