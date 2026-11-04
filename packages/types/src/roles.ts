export const ROLES = ['GATE', 'RM_STORE', 'QC_ANALYST', 'STORES', 'QC_MANAGER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  GATE: 'Gate',
  RM_STORE: 'Raw Material Store',
  QC_ANALYST: 'QC Analyst',
  STORES: 'Stores',
  QC_MANAGER: 'Purchase Manager',
  ADMIN: 'Admin',
};

export const REPORT_STATUSES = [
  'DRAFT',
  'INVOICE_ENTERED',
  'WEIGHTS_ENTERED',
  'QC_ENTERED',
  'PENDING_APPROVAL',
  'APPROVED',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: 'Draft',
  INVOICE_ENTERED: 'Invoice entered',
  WEIGHTS_ENTERED: 'Weights entered',
  QC_ENTERED: 'QC entered · awaiting GRN',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
};

export const REPORT_SOURCES = ['MANUAL', 'IMPORTED'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/** Where each role lands after login. */
export const ROLE_HOME: Record<Role, string> = {
  GATE: '/reports',
  RM_STORE: '/reports',
  QC_ANALYST: '/reports',
  STORES: '/reports',
  QC_MANAGER: '/approvals',
  ADMIN: '/dashboard',
};
