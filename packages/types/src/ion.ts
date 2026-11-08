// Shapes of the "Load on TCS iON" API, shared with the web app.

export const ION_PUSH_STATUSES = ['QUEUED', 'RUNNING', 'DRAFT_CREATED', 'SUBMITTED', 'FAILED', 'FAILED_RETRYABLE', 'CHECK_MANUALLY', 'DRY_RUN_OK'] as const;
export type IonPushStatus = (typeof ION_PUSH_STATUSES)[number];

export const ION_PUSH_STATUS_LABELS: Record<IonPushStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  DRAFT_CREATED: 'Draft created',
  SUBMITTED: 'Submitted',
  FAILED: 'Failed',
  FAILED_RETRYABLE: 'Failed, can retry',
  CHECK_MANUALLY: 'Check manually in iON',
  DRY_RUN_OK: 'Dry run done',
};

export type IonRunMode = 'DRY_RUN' | 'DRAFT_ONLY' | 'FULL';
export type IonEnvironment = 'TRAINING' | 'LIVE';

export interface IonPreflightIssueDto {
  code: string;
  severity: 'block' | 'warn';
  message: string;
}

export interface IonPushStepDto {
  seq: number;
  step: string;
  outcome: 'ok' | 'error' | 'info';
  message: string | null;
  screenshotId: string | null;
  at: string;
}

export interface IonPushDto {
  id: string;
  status: IonPushStatus;
  env: IonEnvironment;
  runMode: IonRunMode;
  ionDnNo: string | null;
  ionStatus: string | null;
  checkpoint: string | null;
  lastError: string | null;
  lastErrorStep: string | null;
  requestedBy: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  /** A worker is working on it right now. */
  active: boolean;
  itemCodeOverride: string | null;
  canRetry: boolean;
  canContinue: boolean;
  canReset: boolean;
  steps: IonPushStepDto[];
  screenshots: { id: string; label: string; at: string }[];
}

export interface IonReportViewDto {
  /** ION_PUSH_ENABLED on the server. */
  enabled: boolean;
  env: IonEnvironment;
  /** Run mode a new job would get. */
  runMode: IonRunMode;
  push: IonPushDto | null;
  /** Earlier pushes that an admin reset. */
  history: { id: string; status: IonPushStatus; ionDnNo: string | null; resetAt: string; resetNote: string | null }[];
  preflight: { ok: boolean; issues: IonPreflightIssueDto[] };
}
