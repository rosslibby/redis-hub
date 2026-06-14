import redisHub from './shared';
import { useClient } from './helpers';

const redisClient = redisHub.client.bind(redisHub);
const defaultClient = redisHub.getDefaultClient.bind(redisHub);
export {
  defaultClient,
  redisClient,
  redisHub,
  useClient,
};
