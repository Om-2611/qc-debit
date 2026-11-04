import type { Prisma } from '@prisma/client';
import { DESK_FOR_STATUS, ROLE_LABELS, type AuthUser, type NotificationDto } from '@dalmia/types';
import { sendPush, type PushPayload } from './push';

type Tx = Prisma.TransactionClient;

export interface HandoffReport {
  id: string;
  reportNo: string;
  truckNumber: string | null;
  partyName: string | null;
}

/** Created inside the hand-off transaction; `sendPending` pushes it once the transaction has committed. */
export interface PendingPush {
  userIds: string[];
  payload: PushPayload;
}

/**
 * Notifies every active user of the desk that now owns the report (never the person who handed it over).
 * No rupee figures go into the text, so it is safe for users who cannot see rates.
 */
export async function notifyHandoff(tx: Tx, report: HandoffReport, newStatus: string, actor: AuthUser): Promise<PendingPush | null> {
  const desk = DESK_FOR_STATUS[newStatus];
  if (!desk) return null;
  const recipients = await tx.user.findMany({
    where: { role: desk.role, isActive: true, id: { not: actor.id } },
    select: { id: true },
  });
  if (recipients.length === 0) return null;

  const what = [report.truckNumber, report.partyName].filter(Boolean).join(' · ');
  const payload: PushPayload = {
    title: `${report.reportNo} is waiting for you`,
    body: `${what ? `${what}: please` : 'Please'} ${desk.task}. Sent by ${actor.name} (${ROLE_LABELS[actor.role]}).`,
    url: `/reports/${report.id}`,
    tag: `report-${report.id}`,
  };
  await tx.notification.createMany({
    data: recipients.map((r) => ({ userId: r.id, reportId: report.id, title: payload.title, body: payload.body, url: payload.url })),
  });
  return { userIds: recipients.map((r) => r.id), payload };
}

export function sendPending(pending: PendingPush | null): void {
  if (pending) void sendPush(pending.userIds, pending.payload);
}

export const toNotificationDto = (n: {
  id: string;
  reportId: string | null;
  title: string;
  body: string;
  url: string;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto => ({
  id: n.id,
  reportId: n.reportId,
  title: n.title,
  body: n.body,
  url: n.url,
  read: n.readAt !== null,
  createdAt: n.createdAt.toISOString(),
});
