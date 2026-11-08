import { describe, expect, it } from 'vitest';
import {
  CHECKPOINTS,
  TransitionError,
  afterFailure,
  applyMilestone,
  canContinueToSubmit,
  canReset,
  canRetry,
  claim,
  continueToSubmit,
  finish,
  initialState,
  recoverStale,
  retry,
  type FailureKind,
  type PushState,
  type RunMode,
} from '../src/ion/state-machine';

const FAILURES: FailureKind[] = ['transient', 'session_expired', 'invoice_not_found', 'duplicate_found', 'verification', 'dialog', 'ion_error', 'unexpected'];

/** Drives a state through milestones, like the worker does. */
function run(s: PushState, ...steps: Parameters<typeof applyMilestone>[1][]): PushState {
  return steps.reduce((acc, m) => applyMilestone(acc, m), s);
}
const started = (mode: RunMode, retries = 2): PushState => claim(initialState(mode, retries));
const clicked = (mode: RunMode = 'FULL'): PushState => run(started(mode), { name: 'draft_click' });
const withDraft = (mode: RunMode = 'FULL'): PushState => run(clicked(mode), { name: 'draft_created', dnNo: 'NL/APDN/4621' });
const edited = (mode: RunMode = 'FULL'): PushState => CHECKPOINTS.reduce((s, c) => applyMilestone(s, { name: 'checkpoint', checkpoint: c }), withDraft(mode));

describe('the happy paths', () => {
  it('full: queued -> running -> draft_created -> submitted, and the worker lets go', () => {
    let s = initialState('FULL', 2);
    expect(s.status).toBe('QUEUED');
    s = claim(s);
    expect(s).toMatchObject({ status: 'RUNNING', locked: true });
    s = run(s, { name: 'draft_click' });
    expect(s.draftClicked).toBe(true);
    s = run(s, { name: 'draft_created', dnNo: ' NL/APDN/4621 ' });
    expect(s).toMatchObject({ status: 'DRAFT_CREATED', ionDnNo: 'NL/APDN/4621' });
    s = CHECKPOINTS.reduce((acc, c) => applyMilestone(acc, { name: 'checkpoint', checkpoint: c }), s);
    s = run(s, { name: 'submit_click' }, { name: 'submitted' });
    expect(s.status).toBe('SUBMITTED');
    s = finish(s, { outcome: 'completed' });
    expect(s).toMatchObject({ status: 'SUBMITTED', locked: false, finished: true });
  });

  it('draft_only stops at the draft after Item Expense and never submits', () => {
    const s = finish(edited('DRAFT_ONLY'), { outcome: 'completed' });
    expect(s).toMatchObject({ status: 'DRAFT_CREATED', locked: false, finished: true });
    expect(() => applyMilestone(edited('DRAFT_ONLY'), { name: 'submit_click' })).toThrow(/never submits/);
    // finishing early is refused
    expect(() => finish(withDraft('DRAFT_ONLY'), { outcome: 'completed' })).toThrow(TransitionError);
  });

  it('dry_run saves nothing: no Save As Draft, ends as DRY_RUN_OK', () => {
    expect(() => applyMilestone(started('DRY_RUN'), { name: 'draft_click' })).toThrow(/dry run/);
    expect(finish(started('DRY_RUN'), { outcome: 'completed' }).status).toBe('DRY_RUN_OK');
  });

  it('a reviewed draft can be continued to Submit, and the worker then resumes that draft', () => {
    const done = finish(edited('DRAFT_ONLY'), { outcome: 'completed' });
    expect(canContinueToSubmit(done)).toBe(true);
    const queued = continueToSubmit(done);
    expect(queued).toMatchObject({ status: 'QUEUED', runMode: 'FULL', ionDnNo: 'NL/APDN/4621' });
    const resumed = claim(queued);
    expect(resumed.status).toBe('DRAFT_CREATED');
    expect(run(resumed, { name: 'submit_click' }, { name: 'submitted' }).status).toBe('SUBMITTED');
    expect(canContinueToSubmit(withDraft('DRAFT_ONLY'))).toBe(false);
  });
});

describe('idempotency: once there is a draft there is never another', () => {
  it('refuses a second Save As Draft or a second draft number in every state that has a draft', () => {
    for (const s of [withDraft(), edited(), run(edited(), { name: 'submit_click' })]) {
      expect(() => applyMilestone(s, { name: 'draft_click' }), s.status).toThrow(TransitionError);
      expect(() => applyMilestone(s, { name: 'draft_created', dnNo: 'NL/APDN/9999' })).toThrow(TransitionError);
    }
    // and before the number is read, the click cannot be repeated
    expect(() => applyMilestone(clicked(), { name: 'draft_click' })).toThrow(/already clicked/);
  });

  it('a failure after the draft stops as FAILED; Retry queues it; the claim resumes the draft and cannot click Save As Draft', () => {
    const failed = finish(withDraft(), { outcome: 'failed', kind: 'verification' });
    expect(failed).toMatchObject({ status: 'FAILED', ionDnNo: 'NL/APDN/4621', locked: false });
    expect(canRetry(failed)).toBe(true);
    const resumed = claim(retry(failed, 2));
    expect(resumed).toMatchObject({ status: 'DRAFT_CREATED', ionDnNo: 'NL/APDN/4621', locked: true });
    expect(() => applyMilestone(resumed, { name: 'draft_click' })).toThrow(TransitionError);
  });

  it('a draft number cannot be recorded without the click, or twice', () => {
    expect(() => applyMilestone(started('FULL'), { name: 'draft_created', dnNo: 'X' })).toThrow(/after Save As Draft/);
    expect(() => applyMilestone(clicked(), { name: 'draft_created', dnNo: '  ' })).toThrow(/empty/);
  });

  it('automatic re-queue can never happen once a draft was clicked', () => {
    for (const kind of FAILURES) {
      for (const s of [clicked(), withDraft(), edited(), run(edited(), { name: 'submit_click' })]) {
        expect(afterFailure(s, kind).status, `${kind} at ${s.status}`).not.toBe('QUEUED');
      }
    }
  });
});

describe('failures', () => {
  it('before any click: transient failures re-queue by themselves, then stop as retryable', () => {
    let s = afterFailure(started('FULL', 2), 'transient');
    expect(s).toMatchObject({ status: 'QUEUED', autoRetriesLeft: 1, locked: false, finished: false });
    s = afterFailure(claim(s), 'transient');
    expect(s).toMatchObject({ status: 'QUEUED', autoRetriesLeft: 0 });
    s = afterFailure(claim(s), 'transient');
    expect(s).toMatchObject({ status: 'FAILED_RETRYABLE', locked: false, finished: true });
  });

  it('before any click: invoice not found and session expired wait for a person; the rest are plain failures', () => {
    expect(afterFailure(started('FULL'), 'invoice_not_found').status).toBe('FAILED_RETRYABLE');
    expect(afterFailure(started('FULL'), 'session_expired').status).toBe('FAILED_RETRYABLE');
    for (const kind of ['verification', 'dialog', 'ion_error', 'unexpected'] as const) expect(afterFailure(started('FULL'), kind).status).toBe('FAILED');
  });

  it('Save As Draft clicked but no number read: always check_manually, whatever the error', () => {
    for (const kind of FAILURES) expect(afterFailure(clicked(), kind).status, kind).toBe('CHECK_MANUALLY');
  });

  it('Submit clicked: always check_manually', () => {
    for (const kind of FAILURES) expect(afterFailure(run(edited(), { name: 'submit_click' }), kind).status, kind).toBe('CHECK_MANUALLY');
  });

  it('a possible duplicate in iON is always check_manually', () => {
    expect(afterFailure(started('FULL'), 'duplicate_found').status).toBe('CHECK_MANUALLY');
  });

  it('a draft that exists before Submit: any failure is FAILED, resumable', () => {
    for (const kind of FAILURES.filter((k) => k !== 'duplicate_found')) expect(afterFailure(edited(), kind).status, kind).toBe('FAILED');
  });

  it('a dead worker counts as a transient failure wherever it died', () => {
    expect(recoverStale(started('FULL')).status).toBe('QUEUED');
    expect(recoverStale(clicked()).status).toBe('CHECK_MANUALLY');
    expect(recoverStale(withDraft()).status).toBe('FAILED');
    expect(recoverStale(run(edited(), { name: 'submit_click' })).status).toBe('CHECK_MANUALLY');
  });
});

describe('retry and reset', () => {
  it('check_manually is never retried, only reset', () => {
    const s = afterFailure(clicked(), 'transient');
    expect(canRetry(s)).toBe(false);
    expect(() => retry(s, 2)).toThrow(TransitionError);
    expect(canReset(s)).toBe(true);
  });

  it('only failed jobs can be retried, a manual retry refills the automatic retries, a running job cannot be reset', () => {
    const failed = afterFailure(started('FULL', 0), 'transient');
    expect(failed.status).toBe('FAILED_RETRYABLE');
    expect(retry(failed, 2)).toMatchObject({ status: 'QUEUED', autoRetriesLeft: 2, finished: false });
    for (const s of [initialState('FULL', 2), started('FULL'), withDraft(), finish(edited('DRAFT_ONLY'), { outcome: 'completed' })]) {
      expect(canRetry(s), s.status).toBe(false);
    }
    expect(canReset(started('FULL'))).toBe(false);
    expect(canReset(initialState('FULL', 2))).toBe(true);
  });
});

describe('order of the steps', () => {
  it('checkpoints go in order and Item Expense is last', () => {
    expect(() => applyMilestone(withDraft(), { name: 'checkpoint', checkpoint: 'expense_saved' })).toThrow(/skips item_saved/);
    expect(() => applyMilestone(withDraft(), { name: 'checkpoint', checkpoint: 'taxes_done' })).toThrow(/skips/);
    const s = run(withDraft(), { name: 'checkpoint', checkpoint: 'item_saved' });
    expect(() => applyMilestone(run(s, { name: 'checkpoint', checkpoint: 'taxes_done' }), { name: 'checkpoint', checkpoint: 'item_saved' })).toThrow(/behind/);
    // repeating the current checkpoint is harmless (a resumed job re-reporting it)
    expect(run(s, { name: 'checkpoint', checkpoint: 'item_saved' }).checkpoint).toBe('item_saved');
  });

  it('Submit needs a full run, a draft, and every edit done; and is only "submitted" after its click', () => {
    expect(() => applyMilestone(withDraft(), { name: 'submit_click' })).toThrow(/Item Expense/);
    expect(() => applyMilestone(started('FULL'), { name: 'submit_click' })).toThrow(/draft/);
    expect(() => applyMilestone(edited(), { name: 'submitted' })).toThrow(/not clicked/);
    expect(() => applyMilestone(run(edited(), { name: 'submit_click' }), { name: 'submit_click' })).toThrow(/already clicked/);
  });

  it('nothing moves unless a worker holds the job', () => {
    expect(() => applyMilestone(initialState('FULL', 2), { name: 'draft_click' })).toThrow(/not held/);
    expect(() => finish(initialState('FULL', 2), { outcome: 'completed' })).toThrow(/not held/);
    expect(() => claim(started('FULL'))).toThrow(/queued/);
  });
});
