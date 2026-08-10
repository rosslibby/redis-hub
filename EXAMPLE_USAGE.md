```ts
// initialization
import { redisHub } from '@notross/redis-hub';

redisHub.init({
  logging: false,
  url: process.env.REDIS_URL,
});

// Redis client
import { useClient } from '@notross/redis-hub';

async function getLatestStatus(): Promise<StatusUpdate> {
  return useClient('status')
    .then((client) => client.get('status_updates')
      .then((statuses) => JSON.parse(statuses))
      .then((updates) => updates[updates.length - 1])
    );
}

// PubSub: publisher utilization
import { useClient } from '@notross/redis-hub';

async function publish(story: NewsStory) {
  const publisher = await useClient('news-story-publisher', {
    pingInterval: 60000,
    socket: {
      keepAlive: true,
      reconnectStrategy: (retries) => {
        if (retries < 10) return new Error(`Redis publisher reconnect attempts exhausted.`);
        return Math.min(retries * 100, 3000);
      },
    },
  });
  publisher.publish(`stories`, JSON.stringify(story));
  publisher.publish(`stories:${story.provider}`, JSON.stringify(story));
  story.tags?.forEach((tag: string) =>
    publisher.publish(`stories:tags:${tag}`, JSON.stringify(story))
  );
}

// PubSub: subscriber utilization
import Stream from 'stream';
import { Request, ResponseToolkit } from '@hapi/hapi';
import { useClient } from '@notross/redis-hub';

export async function streamNewsStories(
  req: Request,
  h: ResponseToolkit,
) {
  const stream = new Stream.PassThrough();
  const subscriber = await useClient('news-story-subscriber', {
    pingInterval: 60000,
    socket: {
      keepAlive: true,
      reconnectStrategy: (retries) => {
        if (retries < 10) return new Error(`Redis subscriber reconnect attempts exhausted.`);
        return Math.min(retries * 100, 3000);
      },
    },
  });
  const onMessage = (message: string, channel: string) => {
    const data = JSON.parse(message);
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  subscriber.pSubscribe(req.params.channelId as string, onMessage);

  req.raw.req.on('close', () => {
    subscriber.quit();
    stream.end();
  });

  return h.response(stream)
    .type('text/event-stream')
    .header('Cache-Control', 'no-cache')
    .header('Connection', 'keep-alive');
}
```