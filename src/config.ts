import { cosmiconfig } from 'cosmiconfig';
import { RedisClientOptions } from 'redis';
import { HubConfig, HubLogger } from './types';

const MODULE_NAME = 'redis-hub';
const LOCALHOST_FALLBACK: RedisClientOptions = { url: 'redis://localhost:6379' };

function logResolution(logger: HubLogger, source: string): void {
  logger.debug({ source }, `redis-hub: no explicit config() call; resolved connection from ${source}`);
}

/**
 * Resolves hub defaults when `RedisHub.config()` was never called, in order:
 * REDIS_HUB_URL -> REDIS_URL -> a cosmiconfig-discovered file -> localhost.
 * JS/CJS/MJS config files may export a full HubConfig (logger, autoShutdown,
 * etc. included); JSON/YAML and bare connection-option files only carry the
 * `redis` portion.
 */
export async function resolveZeroConfig(logger: HubLogger): Promise<HubConfig> {
  const hubUrl = process.env.REDIS_HUB_URL;
  if (hubUrl) {
    logResolution(logger, 'REDIS_HUB_URL');
    return { redis: { url: hubUrl } };
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    logResolution(logger, 'REDIS_URL');
    return { redis: { url: redisUrl } };
  }

  const result = await cosmiconfig(MODULE_NAME).search().catch(() => null);
  if (result && !result.isEmpty && result.config) {
    logResolution(logger, result.filepath);
    const discovered = result.config as HubConfig & RedisClientOptions;
    return discovered.redis ? (discovered as HubConfig) : { redis: discovered as RedisClientOptions };
  }

  logResolution(logger, 'redis://localhost:6379 (default)');
  return { redis: LOCALHOST_FALLBACK };
}
