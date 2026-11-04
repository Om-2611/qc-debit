import { z } from 'zod';
import type { ReportAction } from './permissions';
import type { Role } from './roles';

/**
 * Forward hand-offs that notify the next desk: every active user with that role. Send-back, reopen and approval
 * do not notify (the client asked for hand-offs only). submitQc lands on Stores, or on the Purchase Manager when
 * the GRN already exists — the service picks the role from the status the report actually moved to.
 */
export const HANDOFF_ACTIONS: readonly ReportAction[] = ['submitInvoice', 'submitWeights', 'submitQc', 'submitGrn'];

/** The desk that works on a report in each status, and what it has to do there. */
export const DESK_FOR_STATUS: Partial<Record<string, { role: Role; task: string }>> = {
  INVOICE_ENTERED: { role: 'RM_STORE', task: 'enter the Dalmia weights' },
  WEIGHTS_ENTERED: { role: 'QC_ANALYST', task: 'enter the QC readings' },
  QC_ENTERED: { role: 'STORES', task: 'enter the GRN' },
  PENDING_APPROVAL: { role: 'QC_MANAGER', task: 'approve' },
};

export interface NotificationDto {
  id: string;
  reportId: string | null;
  title: string;
  body: string;
  url: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationDto[];
  unreadCount: number;
}

/** GET /api/notifications/push-config: push is off when the server has no VAPID keys. */
export interface PushConfigResponse {
  enabled: boolean;
  publicKey: string | null;
}

/** The browser's PushSubscription.toJSON(). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });
