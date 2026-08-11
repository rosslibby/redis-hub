```ts
// initialization — optional; skip entirely if REDIS_URL is already set
import { RedisHub } from '@notross/redis-hub';
import pino from 'pino';

RedisHub.config({
  redis: { url: process.env.REDIS_URL },
  logger: pino({ level: 'info' }),
  autoShutdown: true,
});

// Redis client — no setup needed beyond what's above
import { RedisHub } from '@notross/redis-hub';

async function getLatestStatus(): Promise<StatusUpdate> {
  const client = await RedisHub.getClient('status');
  const statuses = await client.get('status_updates');
  const updates = JSON.parse(statuses);
  return updates[updates.length - 1];
}

// PubSub: publisher, via a per-client handle so the name is written once
import { RedisHub } from '@notross/redis-hub';

const publisher = RedisHub.handle('news-story-publisher', {
  redis: {
    url: process.env.REDIS_URL,
    pingInterval: 60000,
    socket: {
      keepAlive: true,
      reconnectStrategy: (retries) => {
        if (retries < 10) return new Error(`Redis publisher reconnect attempts exhausted.`);
        return Math.min(retries * 100, 3000);
      },
    },
  },
});

export async function publish(story: NewsStory) {
  const client = await publisher.client;
  await client.publish(`stories`, JSON.stringify(story));
  await client.publish(`stories:${story.provider}`, JSON.stringify(story));
  await Promise.all(
    (story.tags ?? []).map((tag) => client.publish(`stories:tags:${tag}`, JSON.stringify(story))),
  );
}

// PubSub: subscriber, streamed out over SSE
import Stream from 'stream';
import { Request, ResponseToolkit } from '@hapi/hapi';
import { RedisHub } from '@notross/redis-hub';

export async function streamNewsStories(
  req: Request,
  h: ResponseToolkit,
) {
  const stream = new Stream.PassThrough();
  const subscriber = RedisHub.handle('news-story-subscriber', {
    redis: {
      url: process.env.REDIS_URL,
      pingInterval: 60000,
      socket: {
        keepAlive: true,
        reconnectStrategy: (retries) => {
          if (retries < 10) return new Error(`Redis subscriber reconnect attempts exhausted.`);
          return Math.min(retries * 100, 3000);
        },
      },
    },
  });

  const client = await subscriber.client;
  const onMessage = (message: string) => {
    const data = JSON.parse(message);
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  await client.pSubscribe(req.params.channelId as string, onMessage);

  req.raw.req.on('close', () => {
    subscriber.disconnect();
    stream.end();
  });

  return h.response(stream)
    .type('text/event-stream')
    .header('Cache-Control', 'no-cache')
    .header('Connection', 'keep-alive');
}
```
