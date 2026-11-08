/**
 * The life of one iON push, as pure functions. Nothing here touches the database or iON, so the rules that keep the
 * system from ever creating a second debit note are testable on their own:
 *
 *  - once the draft number is stored it never changes, and nothing goes back to "create a draft";
 *  - Save As Draft / Submit are recorded as clicked BEFORE the click, so a job that dies in between is "check_manually";
 *  - only a failure before any draft click re-queues by itself.
 */

export type PushStatus = 'QUEUED' | 'RUNNING' | 'DRAFT_CREATED' | 'SUBMITTED' | 'FAILED' | 'FAILED_RETRYABLE' | 'CHECK_MANUALLY' | 'DRY_RUN_OK';
export type RunMode = 'DRY_RUN' | 'DRAFT_ONLY' | 'FULL';

/** Furthest finished step of C-F, in order. Item Expense must be last, because iON locks items and taxes after it. */
export const CHECKPOINTS = ['item_saved', 'taxes_done', 'expense_saved'] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

export type FailureKind =
  /** Timeout, network blip, page did not load. */
  | 'transient'
  | 'session_expired'
  /** B14: the purchase voucher is not booked in iON yet. */
  | 'invoice_not_found'
  /** An iON debit note for the same supplier invoice and amount already exists. */
  | 'duplicate_found'
  /** What iON shows differs from what we expect (supplier, date, amount, tax lines, apportion total...). */
  | 'verification'
  | 'dialog'
  | 'ion_error'
  | 'unexpected';

export interface PushState {
  status: PushStatus;
  runMode: RunMode;
  ionDnNo: string | null;
  draftClicked: boolean;
  submitClicked: boolean;
  checkpoint: Checkpoint | null;
  autoRetriesLeft: number;
  /** A worker holds the job. */
  locked: boolean;
  /** The worker has handed the job back (finished, failed or recovered). */
  finished: boolean;
}

export class TransitionError extends Error {}
const refuse = (message: string): never => {
  throw new TransitionError(message);
};

export const initialState = (runMode: RunMode, autoRetries: number): PushState => ({
  status: 'QUEUED',
  runMode,
  ionDnNo: null,
  draftClicked: false,
  submitClicked: false,
  checkpoint: null,
  autoRetriesLeft: autoRetries,
  locked: false,
  finished: false,
});

/** A worker takes the job. With a draft number already stored it resumes that draft, never starts a new one. */
export function claim(s: PushState): PushState {
  if (s.status !== 'QUEUED') return refuse(`Only a queued job can be claimed (it is ${s.status}).`);
  return { ...s, status: s.ionDnNo ? 'DRAFT_CREATED' : 'RUNNING', locked: true, finished: false };
}

export type Milestone =
  | { name: 'draft_click' }
  | { name: 'draft_created'; dnNo: string }
  | { name: 'checkpoint'; checkpoint: Checkpoint }
  | { name: 'submit_click' }
  | { name: 'submitted' };

export function applyMilestone(s: PushState, m: Milestone): PushState {
  if (!s.locked) return refuse('The job is not held by a worker.');
  switch (m.name) {
    case 'draft_click':
      if (s.runMode === 'DRY_RUN') return refuse('A dry run never clicks Save As Draft.');
      if (s.status !== 'RUNNING') return refuse(`Save As Draft is only clicked by a running job without a draft (status ${s.status}).`);
      if (s.ionDnNo || s.draftClicked) return refuse('Save As Draft was already clicked for this job.');
      return { ...s, draftClicked: true };
    case 'draft_created':
      if (s.status !== 'RUNNING' || !s.draftClicked) return refuse('A draft number can only be recorded after Save As Draft was clicked.');
      if (s.ionDnNo) return refuse('This job already has a draft number.');
      if (!m.dnNo.trim()) return refuse('The draft number is empty.');
      return { ...s, status: 'DRAFT_CREATED', ionDnNo: m.dnNo.trim() };
    case 'checkpoint': {
      if (s.status !== 'DRAFT_CREATED' || !s.ionDnNo) return refuse('Checkpoints exist only once the draft is created.');
      if (s.submitClicked) return refuse('Submit was already clicked.');
      const next = CHECKPOINTS.indexOf(m.checkpoint);
      const current = s.checkpoint ? CHECKPOINTS.indexOf(s.checkpoint) : -1;
      if (next < current) return refuse(`Checkpoint ${m.checkpoint} is behind ${s.checkpoint}.`);
      if (next > current + 1) return refuse(`Checkpoint ${m.checkpoint} skips ${CHECKPOINTS[current + 1]}.`);
      return { ...s, checkpoint: m.checkpoint };
    }
    case 'submit_click':
      if (s.runMode !== 'FULL') return refuse(`Run mode ${s.runMode} never submits.`);
      if (s.status !== 'DRAFT_CREATED' || !s.ionDnNo) return refuse('Submit needs an existing draft.');
      if (s.checkpoint !== 'expense_saved') return refuse('Submit comes after the Item Expense step (the last edit).');
      if (s.submitClicked) return refuse('Submit was already clicked for this job.');
      return { ...s, submitClicked: true };
    case 'submitted':
      if (!s.submitClicked || s.status !== 'DRAFT_CREATED') return refuse('Submit was not clicked.');
      return { ...s, status: 'SUBMITTED' };
  }
}

export type Outcome = { outcome: 'completed' } | { outcome: 'failed'; kind: FailureKind };

export function finish(s: PushState, o: Outcome): PushState {
  if (!s.locked) return refuse('The job is not held by a worker.');
  if (o.outcome === 'failed') return afterFailure(s, o.kind);
  const done = { ...s, locked: false, finished: true };
  switch (s.runMode) {
    case 'DRY_RUN':
      if (s.status !== 'RUNNING' || s.draftClicked) return refuse('A dry run finishes before Save As Draft.');
      return { ...done, status: 'DRY_RUN_OK' };
    case 'DRAFT_ONLY':
      if (s.status !== 'DRAFT_CREATED' || s.checkpoint !== 'expense_saved') return refuse('A draft-only run finishes after the Item Expense step.');
      return done;
    case 'FULL':
      if (s.status !== 'SUBMITTED') return refuse('A full run finishes after Submit.');
      return done;
  }
}

/**
 * What a failure (or a dead worker) means. The order matters: whatever might already have happened in iON wins.
 */
export function afterFailure(s: PushState, kind: FailureKind): PushState {
  const stopped = { ...s, locked: false, finished: true };
  if (s.submitClicked) return { ...stopped, status: 'CHECK_MANUALLY' };
  if (s.draftClicked && !s.ionDnNo) return { ...stopped, status: 'CHECK_MANUALLY' };
  if (kind === 'duplicate_found') return { ...stopped, status: 'CHECK_MANUALLY' };
  // A draft exists: stop. Retry resumes it by number.
  if (s.ionDnNo) return { ...stopped, status: 'FAILED' };
  // Nothing was created in iON.
  if (kind === 'transient' && s.autoRetriesLeft > 0) return { ...s, status: 'QUEUED', autoRetriesLeft: s.autoRetriesLeft - 1, locked: false, finished: false };
  if (kind === 'transient' || kind === 'session_expired' || kind === 'invoice_not_found') return { ...stopped, status: 'FAILED_RETRYABLE' };
  return { ...stopped, status: 'FAILED' };
}

/** The worker stopped sending heartbeats. Same as a transient failure at wherever it got to. */
export const recoverStale = (s: PushState): PushState => afterFailure(s, 'transient');

export const canRetry = (s: PushState): boolean =>
  !s.locked && (s.status === 'FAILED' || s.status === 'FAILED_RETRYABLE') && !(s.draftClicked && !s.ionDnNo);

/** Manual Retry: back to the queue. With a draft number the worker resumes that draft; without, nothing exists in iON yet. */
export function retry(s: PushState, autoRetries: number): PushState {
  if (!canRetry(s)) return refuse(`A job that is ${s.status}${s.locked ? ' and running' : ''} cannot be retried.`);
  return { ...s, status: 'QUEUED', autoRetriesLeft: autoRetries, finished: false };
}

export const canContinueToSubmit = (s: PushState): boolean =>
  !s.locked && s.finished && s.status === 'DRAFT_CREATED' && s.runMode === 'DRAFT_ONLY' && s.checkpoint === 'expense_saved' && !!s.ionDnNo;

/** After a draft-only run an admin may let the worker submit the reviewed draft. */
export function continueToSubmit(s: PushState): PushState {
  if (!canContinueToSubmit(s)) return refuse('Only a finished draft-only job can be continued to Submit.');
  return { ...s, status: 'QUEUED', runMode: 'FULL', finished: false };
}

/** An admin may reset anything a worker is not holding. */
export const canReset = (s: PushState): boolean => !s.locked;
