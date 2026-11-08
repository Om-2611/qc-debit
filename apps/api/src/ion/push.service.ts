import { Prisma, type IonPush } from '@prisma/client';
import type { AuthUser, IonPushDto, IonReportViewDto } from '@dalmia/types';
import { defaultIonRunMode, env } from '../env';
import { writeAudit } from '../lib/audit';
import { HttpError, conflict, notFound } from '../lib/errors';
import { sendPush, type PushPayload } from '../notifications/push';
import { prisma } from '../prisma';
import { ION_CONFIG } from './config';
import { preflightReport } from './load';
import { SCREENSHOT_SPEC, cleanupScreenshotsSometimes, screenshotProblem } from './screenshots';
import { isoToIon, todayIst } from './money';
import type { IonPayload } from './preflight';
import * as machine from './state-machine';
import { TransitionError, type Checkpoint, type FailureKind, type Milestone, type PushState } from './state-machine';

type Tx = Prisma.TransactionClient;

/** Serialises "pick the next job" so two workers (or a worker and the recovery sweep) can never both start one. */
const CLAIM_LOCK_KEY = 710201;

const RUN_MODES = { dry_run: 'DRY_RUN', draft_only: 'DRAFT_ONLY', full: 'FULL' } as const;
export type RunModeInput = keyof typeof RUN_MODES;

const ionEnvironment = () => (env.ION_ENV === 'live' ? ('LIVE' as const) : ('TRAINING' as const));

// ---------------------------------------------------------------- row <-> state

const toState = (r: IonPush): machine.PushState => ({
  status: r.status,
  runMode: r.runMode,
  ionDnNo: r.ionDnNo,
  draftClicked: r.draftClickedAt !== null,
  submitClicked: r.submitClickedAt !== null,
  checkpoint: r.checkpoint as Checkpoint | null,
  autoRetriesLeft: r.autoRetriesLeft,
  locked: r.lockedBy !== null,
  finished: r.finishedAt !== null,
});

/** The columns that follow from a new state. Lock owner and heartbeat are set by the caller when a job is claimed. */
function stateData(next: PushState, prev: IonPush, now: Date): Prisma.IonPushUpdateInput {
  return {
    status: next.status,
    runMode: next.runMode,
    ionDnNo: next.ionDnNo,
    checkpoint: next.checkpoint,
    autoRetriesLeft: next.autoRetriesLeft,
    draftClickedAt: next.draftClicked ? (prev.draftClickedAt ?? now) : null,
    submitClickedAt: next.submitClicked ? (prev.submitClickedAt ?? now) : null,
    finishedAt: next.finished ? (prev.finishedAt ?? now) : null,
    ...(next.locked ? {} : { lockedBy: null, heartbeatAt: null }),
  };
}

/** Row lock for the length of the transaction: a heartbeat, a milestone and a recovery sweep never interleave. */
async function loadLocked(tx: Tx, id: string): Promise<IonPush> {
  await tx.$queryRaw`SELECT "id" FROM "IonPush" WHERE "id" = ${id} FOR UPDATE`;
  const row = await tx.ionPush.findUnique({ where: { id } });
  if (!row) throw notFound('iON push not found');
  return row;
}

async function guarded<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TransitionError) throw conflict(err.message);
    throw err;
  }
}

function assertOwner(row: IonPush, workerId: string): void {
  if (row.lockedBy !== workerId) throw conflict('This job is no longer held by this worker.');
}

/** The worker has no user account, so its audit rows sit under the person who requested the job; the action and the value say it was the worker, not them. */
const workerAudit = (row: IonPush, action: string, value: unknown) => ({
  userId: row.requestedById,
  reportId: row.reportId,
  action: `ION_WORKER_${action}`,
  newValue: `${value ?? ''} (by iON worker)`.trim(),
});

const clip = (text: string | null | undefined, max = 2000): string | null => (text ? text.slice(0, max) : null);

async function logStep(tx: Tx, pushId: string, step: string, outcome: 'ok' | 'error' | 'info', message: string | null, screenshotId: string | null = null): Promise<void> {
  const last = await tx.ionPushStep.aggregate({ where: { pushId }, _max: { seq: true } });
  await tx.ionPushStep.create({ data: { pushId, seq: (last._max.seq ?? 0) + 1, step, outcome, message: clip(message), screenshotId } });
}

// ---------------------------------------------------------------- notifications to admins

interface PendingAdminPush {
  userIds: string[];
  payload: PushPayload;
}

async function notifyAdmins(tx: Tx, reportId: string, title: string, body: string): Promise<PendingAdminPush | null> {
  const admins = await tx.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  if (admins.length === 0) return null;
  const payload: PushPayload = { title, body, url: `/reports/${reportId}`, tag: `ion-${reportId}` };
  await tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, reportId, title, body, url: payload.url })) });
  return { userIds: admins.map((a) => a.id), payload };
}

const sendPending = (pending: PendingAdminPush[]): void => {
  for (const p of pending) void sendPush(p.userIds, p.payload);
};

// ---------------------------------------------------------------- stale jobs

/** A worker that stopped sending heartbeats: treated as a transient failure wherever it got to (uncertain = check manually). */
async function recoverStaleIn(tx: Tx, pending: PendingAdminPush[]): Promise<void> {
  const cutoff = new Date(Date.now() - env.ION_HEARTBEAT_TIMEOUT_SECONDS * 1000);
  const stale = await tx.ionPush.findMany({ where: { lockedBy: { not: null }, heartbeatAt: { lt: cutoff } }, select: { id: true } });
  for (const { id } of stale) {
    const row = await loadLocked(tx, id);
    if (row.lockedBy === null || !row.heartbeatAt || row.heartbeatAt >= cutoff) continue; // recovered meanwhile
    const next = machine.recoverStale(toState(row));
    await tx.ionPush.update({
      where: { id },
      data: { ...stateData(next, row, new Date()), lastError: 'The worker stopped responding while running this job.', lastErrorKind: 'transient' },
    });
    await logStep(tx, id, 'worker-lost', 'error', `No heartbeat from ${row.lockedBy}. Job is now ${next.status}.`);
    if (next.status === 'CHECK_MANUALLY') {
      await writeAudit(workerAudit(row, 'CHECK_MANUALLY', 'worker lost'), tx);
      const report = await tx.report.findUniqueOrThrow({ where: { id: row.reportId }, select: { reportNo: true } });
      const p = await notifyAdmins(tx, row.reportId, `${report.reportNo}: check iON manually`, 'The iON worker stopped while loading this debit note. Look in iON before doing anything else.');
      if (p) pending.push(p);
    }
  }
}

export async function recoverStaleJobs(): Promise<void> {
  const pending: PendingAdminPush[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK_KEY})`;
    await recoverStaleIn(tx, pending);
  });
  sendPending(pending);
}

// ---------------------------------------------------------------- admin: create / retry / continue / reset

export interface CreatePushInput {
  itemCodeOverride?: string | null;
  mismatchConfirmed?: boolean;
  runMode?: RunModeInput;
}

export async function createPush(reportId: string, user: AuthUser, input: CreatePushInput): Promise<IonReportViewDto> {
  if (!env.ION_PUSH_ENABLED) throw conflict('Loading on TCS iON is switched off (ION_PUSH_ENABLED).');
  const configured = defaultIonRunMode();
  if (env.ION_ENV === 'live' && input.runMode && input.runMode !== configured) {
    throw conflict(`On live the run mode is fixed by the server (${configured}); it cannot be chosen per job.`);
  }
  const runMode = RUN_MODES[input.runMode ?? configured];

  const report = await prisma.report.findUnique({ where: { id: reportId }, select: { id: true, hasMismatch: true } });
  if (!report) throw notFound('Report not found');
  const confirmed = report.hasMismatch && input.mismatchConfirmed === true;

  const pre = await preflightReport(reportId, { itemCodeOverride: input.itemCodeOverride, mismatchConfirmed: confirmed });
  if (!pre.ok || !pre.payload) {
    throw new HttpError(409, 'PREFLIGHT_FAILED', 'This report cannot be loaded on TCS iON yet.', { issues: pre.issues });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      // An earlier dry run saved nothing in iON; it only gets out of the way.
      await tx.ionPush.updateMany({
        where: { reportId, resetAt: null, runMode: 'DRY_RUN', lockedBy: null },
        data: { resetAt: now, resetById: user.id, resetNote: 'Superseded by a new push' },
      });
      const push = await tx.ionPush.create({
        data: {
          reportId,
          env: ionEnvironment(),
          runMode,
          payload: pre.payload as unknown as Prisma.InputJsonValue,
          itemCodeOverride: input.itemCodeOverride?.trim() || null,
          mismatchConfirmedById: confirmed ? user.id : null,
          requestedById: user.id,
          autoRetriesLeft: env.ION_MAX_AUTO_RETRIES,
        },
      });
      await logStep(tx, push.id, 'requested', 'info', `Requested by ${user.name}: ${ionEnvironment()}, ${runMode}.`);
      const audit = [{ userId: user.id, reportId, action: 'ION_PUSH_CREATE', newValue: `${ionEnvironment()} ${runMode}` }];
      if (confirmed) audit.push({ userId: user.id, reportId, action: 'ION_MISMATCH_CONFIRMED', newValue: `amount ${pre.payload!.amount}` });
      await writeAudit(audit, tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('This report already has an iON push. Reset it first if it must be redone.');
    }
    throw err;
  }
  return getReportView(reportId);
}

async function bindingRow(tx: Tx, reportId: string): Promise<IonPush> {
  const found = await tx.ionPush.findFirst({ where: { reportId, resetAt: null }, orderBy: { requestedAt: 'desc' }, select: { id: true } });
  if (!found) throw notFound('This report has no iON push.');
  return loadLocked(tx, found.id);
}

function assertSameEnvironment(row: IonPush): void {
  if (row.env !== ionEnvironment()) throw conflict(`This job belongs to ${row.env}, but the server is set to ${env.ION_ENV}.`);
}

export async function retryPush(reportId: string, user: AuthUser): Promise<IonReportViewDto> {
  if (!env.ION_PUSH_ENABLED) throw conflict('Loading on TCS iON is switched off (ION_PUSH_ENABLED).');
  await guarded(() =>
    prisma.$transaction(async (tx) => {
      const row = await bindingRow(tx, reportId);
      assertSameEnvironment(row);
      const next = machine.retry(toState(row), env.ION_MAX_AUTO_RETRIES);
      const data: Prisma.IonPushUpdateInput = stateData(next, row, new Date());
      // Before a draft exists nothing is in iON yet, so the voucher date is simply today again.
      if (!row.ionDnNo) data.payload = { ...(row.payload as object), voucherDate: isoToIon(todayIst()) } as Prisma.InputJsonValue;
      await tx.ionPush.update({ where: { id: row.id }, data });
      await logStep(tx, row.id, 'retry', 'info', `Retry by ${user.name}${row.ionDnNo ? `: resuming draft ${row.ionDnNo}` : ''}.`);
      await writeAudit({ userId: user.id, reportId, action: 'ION_PUSH_RETRY', oldValue: row.status, newValue: row.ionDnNo ?? 'new draft' }, tx);
    }),
  );
  return getReportView(reportId);
}

/** After a draft-only run: let the worker submit the draft a person has reviewed in iON. */
export async function continueToSubmit(reportId: string, user: AuthUser): Promise<IonReportViewDto> {
  if (!env.ION_PUSH_ENABLED) throw conflict('Loading on TCS iON is switched off (ION_PUSH_ENABLED).');
  if (env.ION_ENV === 'live' && defaultIonRunMode() !== 'full') {
    throw conflict('On live the server runs draft-only; submitting from here is switched off (ION_RUN_MODE).');
  }
  await guarded(() =>
    prisma.$transaction(async (tx) => {
      const row = await bindingRow(tx, reportId);
      assertSameEnvironment(row);
      const next = machine.continueToSubmit(toState(row));
      await tx.ionPush.update({ where: { id: row.id }, data: stateData(next, row, new Date()) });
      await logStep(tx, row.id, 'continue', 'info', `${user.name} asked for Submit on draft ${row.ionDnNo}.`);
      await writeAudit({ userId: user.id, reportId, action: 'ION_PUSH_CONTINUE', newValue: row.ionDnNo }, tx);
    }),
  );
  return getReportView(reportId);
}

export interface ResetInput {
  /** The QC report number, typed by the admin. */
  confirm: string;
  note: string;
}

export async function resetPush(reportId: string, user: AuthUser, input: ResetInput): Promise<{ warning: string | null }> {
  const report = await prisma.report.findUnique({ where: { id: reportId }, select: { reportNo: true } });
  if (!report) throw notFound('Report not found');
  if (input.confirm.trim() !== report.reportNo) throw conflict(`Type the report number ${report.reportNo} to confirm the reset.`);
  const note = input.note.trim();
  if (note.length < 5) throw conflict('Give a reason for the reset (at least 5 characters).');

  return guarded(() =>
    prisma.$transaction(async (tx) => {
      const row = await bindingRow(tx, reportId);
      if (!machine.canReset(toState(row))) throw conflict('A worker is running this job. Wait for it to stop first.');
      await tx.ionPush.update({ where: { id: row.id }, data: { resetAt: new Date(), resetById: user.id, resetNote: note } });
      await logStep(tx, row.id, 'reset', 'info', `Reset by ${user.name}: ${note}`);
      await writeAudit(
        {
          userId: user.id,
          reportId,
          action: 'ION_PUSH_RESET',
          oldValue: `${row.status}${row.ionDnNo ? ` ${row.ionDnNo}` : ''}`,
          newValue: note,
        },
        tx,
      );
      const warning = row.ionDnNo
        ? `iON debit note ${row.ionDnNo} still exists in iON. Resetting does not delete it; cancel it there before loading this report again.`
        : row.draftClickedAt
          ? 'The job clicked Save As Draft but never confirmed a number: look in iON for a debit note of this supplier invoice before loading it again.'
          : null;
      return { warning };
    }),
  );
}

// ---------------------------------------------------------------- admin: the view

export const toPushDto = (
  row: IonPush & { requestedBy: { name: string }; steps: { seq: number; step: string; outcome: string; message: string | null; screenshotId: string | null; at: Date }[]; screenshots: { id: string; label: string; createdAt: Date }[] },
): IonPushDto => {
  const state = toState(row);
  return {
    id: row.id,
    status: row.status,
    env: row.env,
    runMode: row.runMode,
    ionDnNo: row.ionDnNo,
    ionStatus: row.ionStatus,
    checkpoint: row.checkpoint,
    lastError: row.lastError,
    lastErrorStep: row.lastErrorStep,
    requestedBy: row.requestedBy.name,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    attempts: row.attempts,
    active: state.locked,
    itemCodeOverride: row.itemCodeOverride,
    canRetry: machine.canRetry(state),
    canContinue: machine.canContinueToSubmit(state),
    canReset: machine.canReset(state),
    steps: row.steps.map((s) => ({ seq: s.seq, step: s.step, outcome: s.outcome as 'ok' | 'error' | 'info', message: s.message, screenshotId: s.screenshotId, at: s.at.toISOString() })),
    screenshots: row.screenshots.map((s) => ({ id: s.id, label: s.label, at: s.createdAt.toISOString() })),
  };
};

export async function getReportView(reportId: string): Promise<IonReportViewDto> {
  await recoverStaleJobs();
  const [push, history, pre] = await Promise.all([
    prisma.ionPush.findFirst({
      where: { reportId, resetAt: null },
      orderBy: { requestedAt: 'desc' },
      include: {
        requestedBy: { select: { name: true } },
        steps: { orderBy: { seq: 'asc' } },
        screenshots: { select: { id: true, label: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.ionPush.findMany({ where: { reportId, resetAt: { not: null } }, orderBy: { resetAt: 'desc' }, select: { id: true, status: true, ionDnNo: true, resetAt: true, resetNote: true } }),
    // The confirmation tick lives on the push; before one exists the page shows the blocker so the admin can tick it.
    preflightReport(reportId),
  ]);
  return {
    enabled: env.ION_PUSH_ENABLED,
    env: ionEnvironment(),
    runMode: RUN_MODES[defaultIonRunMode()],
    push: push ? toPushDto(push) : null,
    history: history.map((h) => ({ id: h.id, status: h.status, ionDnNo: h.ionDnNo, resetAt: h.resetAt!.toISOString(), resetNote: h.resetNote })),
    preflight: { ok: pre.ok, issues: pre.issues },
  };
}

export async function getScreenshot(id: string): Promise<{ mime: string; data: Buffer }> {
  const shot = await prisma.ionScreenshot.findUnique({ where: { id } });
  if (!shot) throw notFound('Screenshot not found');
  return { mime: shot.mime, data: Buffer.from(shot.data) };
}

// ---------------------------------------------------------------- worker

export interface WorkerJob {
  id: string;
  env: 'TRAINING' | 'LIVE';
  runMode: 'DRY_RUN' | 'DRAFT_ONLY' | 'FULL';
  payload: IonPayload;
  /** A draft already exists: open it by number and continue after `checkpoint`; never create another. */
  resume: { dnNo: string; checkpoint: Checkpoint | null } | null;
  config: {
    grirLedger: string;
    tdsTaxCodeText: string;
    deleteTdsLine: boolean;
    deleteZeroItemLines: boolean;
    taxToleranceRupees: number;
    voucherType: string;
    voucherSubType: string;
    /** Every screenshot must be a JPEG of this quality and at most this wide (set the browser viewport to maxWidth). */
    screenshot: { type: 'jpeg'; quality: number; maxWidth: number };
  };
}

export async function claimNext(workerId: string, environment: 'training' | 'live'): Promise<WorkerJob | null> {
  if (!env.ION_PUSH_ENABLED) return null;
  cleanupScreenshotsSometimes();
  const pending: PendingAdminPush[] = [];
  const job = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK_KEY})`;
    await recoverStaleIn(tx, pending);
    // One job at a time across both environments: there is one iON session.
    if (await tx.ionPush.findFirst({ where: { lockedBy: { not: null } }, select: { id: true } })) return null;
    const next = await tx.ionPush.findFirst({
      where: { status: 'QUEUED', env: environment === 'live' ? 'LIVE' : 'TRAINING', resetAt: null },
      orderBy: { requestedAt: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    const row = await loadLocked(tx, next.id);
    const state = machine.claim(toState(row));
    const now = new Date();
    const updated = await tx.ionPush.update({
      where: { id: row.id },
      data: { ...stateData(state, row, now), lockedBy: workerId, heartbeatAt: now, startedAt: row.startedAt ?? now, attempts: { increment: 1 } },
    });
    await logStep(tx, row.id, 'claimed', 'info', `${workerId} took the job${row.ionDnNo ? `, resuming draft ${row.ionDnNo}` : ''} (attempt ${updated.attempts}).`);
    return updated;
  });
  sendPending(pending);
  if (!job) return null;
  return {
    id: job.id,
    env: job.env,
    runMode: job.runMode,
    payload: job.payload as unknown as IonPayload,
    resume: job.ionDnNo ? { dnNo: job.ionDnNo, checkpoint: job.checkpoint as Checkpoint | null } : null,
    config: {
      grirLedger: ION_CONFIG.grirLedger,
      tdsTaxCodeText: ION_CONFIG.tdsTaxCodeText,
      deleteTdsLine: ION_CONFIG.deleteTdsLine,
      deleteZeroItemLines: ION_CONFIG.deleteZeroItemLines,
      taxToleranceRupees: ION_CONFIG.taxToleranceRupees,
      voucherType: ION_CONFIG.voucherType,
      voucherSubType: ION_CONFIG.voucherSubType,
      screenshot: { type: 'jpeg', quality: SCREENSHOT_SPEC.quality, maxWidth: SCREENSHOT_SPEC.maxWidth },
    },
  };
}

async function withOwnedJob<T>(id: string, workerId: string, fn: (tx: Tx, row: IonPush) => Promise<T>): Promise<T> {
  return guarded(() =>
    prisma.$transaction(async (tx) => {
      const row = await loadLocked(tx, id);
      assertOwner(row, workerId);
      return fn(tx, row);
    }),
  );
}

export async function heartbeat(id: string, workerId: string): Promise<void> {
  await withOwnedJob(id, workerId, async (tx, row) => {
    await tx.ionPush.update({ where: { id: row.id }, data: { heartbeatAt: new Date() } });
  });
}

export interface StepInput {
  step: string;
  outcome: 'ok' | 'error' | 'info';
  message?: string | null;
  screenshotId?: string | null;
}

export async function recordStep(id: string, workerId: string, input: StepInput): Promise<void> {
  await withOwnedJob(id, workerId, async (tx, row) => {
    await tx.ionPush.update({ where: { id: row.id }, data: { heartbeatAt: new Date() } });
    await logStep(tx, row.id, input.step, input.outcome, input.message ?? null, input.screenshotId ?? null);
  });
}

export async function saveScreenshot(id: string, workerId: string, label: string, mime: string, data: Buffer): Promise<string> {
  const problem = screenshotProblem(mime, data);
  if (problem) throw conflict(problem);
  return withOwnedJob(id, workerId, async (tx, row) => {
    const shot = await tx.ionScreenshot.create({ data: { pushId: row.id, label: label.slice(0, 100), mime, data: new Uint8Array(data) } });
    await tx.ionPush.update({ where: { id: row.id }, data: { heartbeatAt: new Date() } });
    return shot.id;
  });
}

export interface MilestoneInput {
  name: Milestone['name'];
  dnNo?: string;
  checkpoint?: Checkpoint;
  ionStatus?: string;
}

/**
 * The worker reports each irreversible moment and waits for the answer: `draft_click` and `submit_click` are written
 * BEFORE the button is pressed, `draft_created` carries the number read from the screen.
 */
export async function recordMilestone(id: string, workerId: string, input: MilestoneInput): Promise<void> {
  let milestone: Milestone;
  switch (input.name) {
    case 'draft_created':
      if (!input.dnNo) throw conflict('draft_created needs the debit note number.');
      milestone = { name: 'draft_created', dnNo: input.dnNo };
      break;
    case 'checkpoint':
      if (!input.checkpoint) throw conflict('checkpoint needs a checkpoint name.');
      milestone = { name: 'checkpoint', checkpoint: input.checkpoint };
      break;
    default:
      milestone = { name: input.name };
  }
  await withOwnedJob(id, workerId, async (tx, row) => {
    const next = machine.applyMilestone(toState(row), milestone);
    const data: Prisma.IonPushUpdateInput = { ...stateData(next, row, new Date()), heartbeatAt: new Date() };
    if (input.name === 'draft_created') data.ionStatus = clip(input.ionStatus, 100) ?? 'Draft';
    if (input.name === 'submitted') data.ionStatus = clip(input.ionStatus, 100) ?? 'Submitted';
    await tx.ionPush.update({ where: { id: row.id }, data });
    const label = input.name === 'checkpoint' ? `checkpoint ${input.checkpoint}` : input.name.replace('_', ' ');
    await logStep(tx, row.id, `milestone: ${label}`, 'ok', input.dnNo ?? null);
    if (input.name === 'draft_created' || input.name === 'submitted') {
      await writeAudit(workerAudit(row, input.name === 'draft_created' ? 'DRAFT_CREATED' : 'SUBMITTED', next.ionDnNo), tx);
    }
  });
}

export interface FinishInput {
  outcome: 'completed' | 'failed';
  kind?: FailureKind;
  error?: string;
  errorStep?: string;
  /** For duplicate_found: the iON debit note numbers that look like this one. */
  dnNumbersFound?: string[];
}

export async function finishJob(id: string, workerId: string, input: FinishInput): Promise<IonPush> {
  const pending: PendingAdminPush[] = [];
  const row = await withOwnedJob(id, workerId, async (tx, row) => {
    const outcome: machine.Outcome = input.outcome === 'completed' ? { outcome: 'completed' } : { outcome: 'failed', kind: input.kind ?? 'unexpected' };
    const next = machine.finish(toState(row), outcome);
    const data: Prisma.IonPushUpdateInput = stateData(next, row, new Date());
    if (input.outcome === 'failed') {
      const dn = input.dnNumbersFound?.length ? ` iON debit notes found: ${input.dnNumbersFound.join(', ')}.` : '';
      data.lastError = clip(`${input.error ?? 'The job failed.'}${dn}`);
      data.lastErrorStep = clip(input.errorStep, 100);
      data.lastErrorKind = input.kind ?? 'unexpected';
    } else {
      data.lastError = null;
      data.lastErrorStep = null;
      data.lastErrorKind = null;
    }
    const updated = await tx.ionPush.update({ where: { id: row.id }, data });
    await logStep(tx, row.id, input.outcome === 'completed' ? 'finished' : 'failed', input.outcome === 'completed' ? 'ok' : 'error', input.outcome === 'completed' ? `Job finished: ${next.status}.` : `${updated.lastError} (now ${next.status})`);

    const report = await tx.report.findUniqueOrThrow({ where: { id: row.reportId }, select: { reportNo: true } });
    if (input.outcome === 'failed') {
      if (next.status === 'FAILED' || next.status === 'FAILED_RETRYABLE' || next.status === 'CHECK_MANUALLY') {
        await writeAudit({ ...workerAudit(row, next.status === 'CHECK_MANUALLY' ? 'CHECK_MANUALLY' : 'PUSH_FAILED', updated.lastError), oldValue: input.kind }, tx);
      }
      if (input.kind === 'session_expired') {
        const p = await notifyAdmins(tx, row.reportId, 'iON session expired', 'The iON worker is logged out. Run "pnpm ion:login" on the worker PC, then Retry. No debit note was created.');
        if (p) pending.push(p);
      } else if (next.status === 'CHECK_MANUALLY') {
        const p = await notifyAdmins(tx, row.reportId, `${report.reportNo}: check iON manually`, 'The iON job could not confirm what iON saved. Look in iON before doing anything else.');
        if (p) pending.push(p);
      }
    }
    return updated;
  });
  sendPending(pending);
  return row;
}

