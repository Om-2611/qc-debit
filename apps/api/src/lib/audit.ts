import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export interface AuditEntry {
  userId: string;
  action: string;
  reportId?: string | null;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

const text = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
};

/** Pass the transaction client so the audit rows commit or roll back with the change they describe. */
export async function writeAudit(
  entries: AuditEntry | AuditEntry[],
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await client.auditLog.createMany({
    data: list.map((e) => ({
      userId: e.userId,
      action: e.action,
      reportId: e.reportId ?? null,
      field: e.field ?? null,
      oldValue: text(e.oldValue),
      newValue: text(e.newValue),
    })),
  });
}
