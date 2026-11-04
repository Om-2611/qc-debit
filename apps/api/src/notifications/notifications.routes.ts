import { Router } from 'express';
import {
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  type NotificationListResponse,
  type PushConfigResponse,
} from '@dalmia/types';
import { currentUser } from '../auth/middleware';
import { notFound } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';
import { toNotificationDto } from './notification.service';
import { pushPublicKey } from './push';

/** Mounted at /api/notifications behind requireAuth; every user sees only their own notifications. */
export const notificationsRouter = Router();

const LIST_LIMIT = 30;

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUser(req).id;
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    const body: NotificationListResponse = { items: items.map(toNotificationDto), unreadCount };
    res.json(body);
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: currentUser(req).id, readAt: null }, data: { readAt: new Date() } });
    res.status(204).end();
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const where = { id: req.params.id!, userId: currentUser(req).id };
    const updated = await prisma.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } });
    if (updated.count === 0 && !(await prisma.notification.findFirst({ where }))) throw notFound('Notification not found');
    res.status(204).end();
  }),
);

notificationsRouter.get('/push-config', (_req, res) => {
  const publicKey = pushPublicKey();
  const body: PushConfigResponse = { enabled: publicKey !== null, publicKey };
  res.json(body);
});

// The endpoint identifies the browser: whoever is signed in there now receives its notifications.
notificationsRouter.post(
  '/push-subscriptions',
  asyncHandler(async (req, res) => {
    const { endpoint, keys } = parseBody(pushSubscriptionSchema, req);
    const userId = currentUser(req).id;
    const userAgent = req.get('user-agent')?.slice(0, 300) ?? null;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId, userAgent },
      update: { p256dh: keys.p256dh, auth: keys.auth, userId, userAgent },
    });
    res.status(204).end();
  }),
);

// Called on sign-out, so a shared PC stops receiving the previous user's notifications.
notificationsRouter.delete(
  '/push-subscriptions',
  asyncHandler(async (req, res) => {
    const { endpoint } = parseBody(pushUnsubscribeSchema, req);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: currentUser(req).id } });
    res.status(204).end();
  }),
);
