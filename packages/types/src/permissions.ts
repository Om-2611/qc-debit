import type { ReportStatus, Role } from './roles';

/** Editable sections of a report, in the sheet's order. */
export const REPORT_SECTIONS = ['header', 'invoiceWeights', 'dalmiaWeights', 'qc', 'grn', 'approval'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const REPORT_ACTIONS = ['submitInvoice', 'submitWeights', 'submitQc', 'submitGrn', 'approve', 'sendBack', 'reopen'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

interface Rule {
  owner: Exclude<Role, 'ADMIN'> | null; // null = admin only
  statuses: readonly ReportStatus[];
}

/**
 * Single source of truth for "who may edit what, when". The API enforces it; the web app only
 * uses it to hide/disable. ADMIN may act as any role, but nobody edits an APPROVED report —
 * an admin must Reopen it first (which is logged).
 */
export const SECTION_RULES: Record<ReportSection, Rule> = {
  header: { owner: 'GATE', statuses: ['DRAFT', 'INVOICE_ENTERED', 'WEIGHTS_ENTERED'] },
  // Sheet rows 15–17 "As per Supplier Invoice" plus row 20 (the Dalmia rate, from the PO): typed at the gate.
  invoiceWeights: { owner: 'GATE', statuses: ['DRAFT'] },
  // Sheet rows 18–19 "As per Dalmia" weight and bales, typed by the Raw Material Store.
  dalmiaWeights: { owner: 'RM_STORE', statuses: ['INVOICE_ENTERED'] },
  // QC_ENTERED = QC submitted, waiting for the GRN; it is also where a report rests after a send-back.
  qc: { owner: 'QC_ANALYST', statuses: ['WEIGHTS_ENTERED', 'QC_ENTERED'] },
  // Sheet I13: the GRN, raised by Stores once QC is done.
  grn: { owner: 'STORES', statuses: ['QC_ENTERED'] },
  approval: { owner: 'QC_MANAGER', statuses: ['PENDING_APPROVAL'] },
};

export const ACTION_RULES: Record<ReportAction, Rule> = {
  submitInvoice: { owner: 'GATE', statuses: ['DRAFT'] },
  submitWeights: { owner: 'RM_STORE', statuses: ['INVOICE_ENTERED'] },
  submitQc: { owner: 'QC_ANALYST', statuses: ['WEIGHTS_ENTERED', 'QC_ENTERED'] },
  submitGrn: { owner: 'STORES', statuses: ['QC_ENTERED'] },
  approve: { owner: 'QC_MANAGER', statuses: ['PENDING_APPROVAL'] },
  sendBack: { owner: 'QC_MANAGER', statuses: ['PENDING_APPROVAL'] },
  reopen: { owner: null, statuses: ['APPROVED'] },
};

/** Status a report moves to when the action succeeds. */
export const ACTION_TARGET: Record<ReportAction, ReportStatus> = {
  submitInvoice: 'INVOICE_ENTERED',
  submitWeights: 'WEIGHTS_ENTERED',
  // Goes straight to PENDING_APPROVAL instead when the GRN is already there (a resubmit after a send-back).
  submitQc: 'QC_ENTERED',
  submitGrn: 'PENDING_APPROVAL',
  approve: 'APPROVED',
  sendBack: 'QC_ENTERED',
  reopen: 'PENDING_APPROVAL',
};

export interface PermissionResult {
  allowed: boolean;
  /** Human-readable reason, returned verbatim in 403 responses. */
  reason?: string;
}

function check(kind: string, name: string, rule: Rule, role: Role, status: ReportStatus): PermissionResult {
  const roleOk = role === 'ADMIN' || (rule.owner !== null && role === rule.owner);
  if (!roleOk) {
    const owner = rule.owner ?? 'ADMIN';
    return { allowed: false, reason: `Only ${owner} (or ADMIN) can ${kind} "${name}"; your role is ${role}.` };
  }
  if (!rule.statuses.includes(status)) {
    const hint = status === 'APPROVED' ? ' An admin must reopen the report first.' : '';
    return {
      allowed: false,
      reason: `"${name}" is not allowed while the report is ${status} (allowed in: ${rule.statuses.join(', ')}).${hint}`,
    };
  }
  return { allowed: true };
}

export function canEditSection(role: Role, status: ReportStatus, section: ReportSection): PermissionResult {
  const rule = SECTION_RULES[section];
  // Admin may fix any section of a report that is still in progress.
  if (role === 'ADMIN' && status !== 'APPROVED') return { allowed: true };
  return check('edit', section, rule, role, status);
}

export function canPerformAction(role: Role, status: ReportStatus, action: ReportAction): PermissionResult {
  return check('perform', action, ACTION_RULES[action], role, status);
}

export function canCreateReport(role: Role): boolean {
  return role === 'GATE' || role === 'ADMIN';
}
