import { createApp } from './app';
import { env } from './env';
import { configurePush } from './notifications/push';
import { prisma } from './prisma';

configurePush(
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
    : null,
);
if (!env.VAPID_PUBLIC_KEY) console.warn('VAPID keys are not set: browser push notifications are off (the in-app bell still works).');

const app = createApp();

const server = app.listen(env.API_PORT, () => {
  console.log(`Dalmia QC API listening on http://localhost:${env.API_PORT} (${env.NODE_ENV})`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
