import webpush from 'web-push';
import { prisma } from '../prisma';

export interface PushKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Replaces an earlier notification with the same tag (one per report) instead of stacking. */
  tag?: string;
}

let keys: PushKeys | null = null;

/** Called once at start-up (and by tests). Without keys, push is off and only the in-app bell is used. */
export function configurePush(next: PushKeys | null): void {
  keys = next?.publicKey && next.privateKey ? next : null;
  if (keys) webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
}

export const pushPublicKey = (): string | null => keys?.publicKey ?? null;

/**
 * Sends to every browser the users have enabled. Never throws: a failed push must not affect the hand-off,
 * which has already committed and is visible in the bell. Subscriptions the push service reports as gone
 * (404/410: permission revoked, browser data cleared) are deleted.
 */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<void> {
  if (!keys || userIds.length === 0) return;
  try {
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: 24 * 60 * 60,
            urgency: 'high',
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
          } else {
            console.warn(`Push to ${new URL(s.endpoint).host} failed (${status ?? 'network'}):`, (err as Error).message);
          }
        }
      }),
    );
  } catch (err) {
    console.warn('Push notifications could not be sent:', (err as Error).message);
  }
}
