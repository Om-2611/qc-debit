import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { ION_PUSH_STATUS_LABELS, type IonPreflightIssueDto, type IonPushDto, type IonPushStatus, type IonReportViewDto } from '@dalmia/types';
import { errorMessage } from '../../api/admin';
import { ApiRequestError } from '../../api/client';
import { loadIonScreenshot, useIonContinue, useIonPush, useIonReset, useIonRetry, useIonView } from '../../api/ion';
import { formatDateTime } from '../../lib/format';

const STATUS_STYLE: Record<IonPushStatus, { bg: string; fg: string }> = {
  QUEUED: { bg: '#EEEEEE', fg: 'var(--text-secondary)' },
  RUNNING: { bg: 'var(--brand-primary-light)', fg: 'var(--brand-primary)' },
  DRAFT_CREATED: { bg: '#E3F1E4', fg: 'var(--success)' },
  SUBMITTED: { bg: '#E3F1E4', fg: 'var(--success)' },
  FAILED: { bg: '#FDE7E7', fg: '#8A1C1C' },
  FAILED_RETRYABLE: { bg: '#FFF3D6', fg: '#7A5200' },
  CHECK_MANUALLY: { bg: '#FDE7E7', fg: '#8A1C1C' },
  DRY_RUN_OK: { bg: '#EEEEEE', fg: 'var(--text-secondary)' },
};

const RUN_MODE_LABEL = { DRY_RUN: 'Dry run (nothing saved)', DRAFT_ONLY: 'Draft only', FULL: 'Create and submit' } as const;

/** What the button will do, in words the admin can check before confirming. */
const RUN_MODE_HELP = {
  DRY_RUN: 'The robot fills in the header and stops before Save As Draft. Nothing is saved in iON.',
  DRAFT_ONLY: 'The robot creates the debit note as a draft in iON and stops. A person reviews it there. It is never approved by the robot.',
  FULL: 'The robot creates the debit note in iON and submits it. It is never approved by the robot: approval stays with the accountant.',
} as const;

/** A blocker that the admin can clear right here, on this form. */
const FIXABLE_HERE = new Set(['MISMATCH_UNCONFIRMED', 'ITEM_CODE_MISSING']);

function preflightIssues(failure: unknown): IonPreflightIssueDto[] | null {
  if (!(failure instanceof ApiRequestError) || failure.code !== 'PREFLIGHT_FAILED') return null;
  return ((failure.details as { issues?: IonPreflightIssueDto[] } | undefined)?.issues ?? null) as IonPreflightIssueDto[] | null;
}

/** Admin only, on an approved report: loads the debit note on TCS iON in the background and follows the job. */
export function IonPanel({ reportId, reportNo }: { reportId: string; reportNo: string }) {
  const { data: view, error, isLoading } = useIonView(reportId, true);
  const push = useIonPush(reportId);
  const retry = useIonRetry(reportId);
  const proceed = useIonContinue(reportId);
  const reset = useIonReset(reportId);

  const [mismatchOk, setMismatchOk] = useState(false);
  const [itemOverride, setItemOverride] = useState('');
  const [confirm, setConfirm] = useState<'push' | 'continue' | 'reset' | null>(null);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shot, setShot] = useState<{ label: string; url: string | null } | null>(null);

  useEffect(() => () => void (shot?.url && URL.revokeObjectURL(shot.url)), [shot]);

  if (isLoading) return <LinearProgress />;
  if (error || !view) return <Alert severity="error">TCS iON status could not be loaded: {errorMessage(error)}</Alert>;

  const p = view.push;
  const busy = push.isPending || retry.isPending || proceed.isPending || reset.isPending;
  const blockers = view.preflight.issues.filter((i) => i.severity === 'block');
  const stillBlocking = blockers.filter((i) => !(FIXABLE_HERE.has(i.code) && (i.code === 'MISMATCH_UNCONFIRMED' ? mismatchOk : itemOverride.trim() !== '')));
  const canLoad = view.enabled && !p && stillBlocking.length === 0 && !busy;
  const serverIssues = preflightIssues(failure);

  const run = async (action: () => Promise<unknown>) => {
    setFailure(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setFailure(err);
    }
  };

  const openShot = async (id: string, label: string) => {
    setShot({ label, url: null });
    try {
      setShot({ label, url: await loadIonScreenshot(id) });
    } catch {
      setShot(null);
      setFailure(new Error('The screenshot could not be loaded.'));
    }
  };

  return (
    <Paper variant="outlined" component="section" sx={{ overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, px: 2, pt: 1.5, pb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography className="section-label">Accounts · Admin only</Typography>
          <Typography variant="h4" component="h2">
            TCS iON debit note
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" label={view.env === 'LIVE' ? 'Live iON' : 'Training iON'} color={view.env === 'LIVE' ? 'error' : 'default'} />
        <Chip size="small" variant="outlined" label={RUN_MODE_LABEL[p?.runMode ?? view.runMode]} />
      </Box>
      {p && (p.active || p.status === 'QUEUED') && <LinearProgress />}

      <Stack spacing={1.5} sx={{ p: 2 }}>
        {!view.enabled && (
          <Alert severity="info">Loading on TCS iON is switched off on the server (ION_PUSH_ENABLED). Nothing can be loaded until it is switched on.</Alert>
        )}
        {failure !== null && (
          <Alert severity="error" onClose={() => setFailure(null)}>
            <AlertTitle>{errorMessage(failure, 'Something went wrong.')}</AlertTitle>
            {serverIssues?.map((i) => <div key={i.code}>• {i.message}</div>)}
          </Alert>
        )}
        {notice && <Alert severity="warning" onClose={() => setNotice(null)}>{notice}</Alert>}

        {!p ? (
          <NotLoaded
            view={view}
            blockers={blockers}
            mismatchOk={mismatchOk}
            setMismatchOk={setMismatchOk}
            itemOverride={itemOverride}
            setItemOverride={setItemOverride}
            canLoad={canLoad}
            onLoad={() => setConfirm('push')}
          />
        ) : (
          <Loaded
            push={p}
            busy={busy}
            onRetry={() => void run(() => retry.mutateAsync())}
            onContinue={() => setConfirm('continue')}
            onReset={() => setConfirm('reset')}
            onShot={openShot}
          />
        )}

        {view.history.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Earlier pushes that were reset
            </Typography>
            {view.history.map((h) => (
              <Typography key={h.id} variant="body2" color="text.secondary">
                {ION_PUSH_STATUS_LABELS[h.status]}
                {h.ionDnNo ? ` · ${h.ionDnNo}` : ''} · reset {formatDateTime(h.resetAt)}
                {h.resetNote ? ` · “${h.resetNote}”` : ''}
              </Typography>
            ))}
          </Box>
        )}
      </Stack>

      <Dialog open={confirm === 'push' || confirm === 'continue'} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm === 'continue' ? 'Submit the reviewed draft?' : `Load ${reportNo} on TCS iON?`}</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {confirm === 'continue' ? (
              <>The robot will open the draft {p?.ionDnNo} in iON and submit it. It will not approve it.</>
            ) : (
              <>
                <strong>{view.env === 'LIVE' ? 'Live iON' : 'Training iON'}.</strong> {RUN_MODE_HELP[view.runMode]}
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => {
              const which = confirm;
              setConfirm(null);
              void run(() => (which === 'continue' ? proceed.mutateAsync() : push.mutateAsync({ itemCodeOverride: itemOverride.trim() || null, mismatchConfirmed: mismatchOk })));
            }}
          >
            {confirm === 'continue' ? 'Submit' : 'Load on TCS iON'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirm === 'reset'} onClose={() => setConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Reset the iON push</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              Resetting only frees this QC report so it can be loaded again. It does <strong>not</strong> delete anything in iON
              {p?.ionDnNo ? `: debit note ${p.ionDnNo} stays there until it is cancelled in iON` : ''}.
            </Alert>
            <TextField label={`Type ${reportNo} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            <TextField label="Why is it being reset?" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} helperText="Kept in the audit log." />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || typed.trim() !== reportNo || note.trim().length < 5}
            onClick={() => {
              setConfirm(null);
              void run(async () => {
                const result = await reset.mutateAsync({ confirm: typed.trim(), note: note.trim() });
                setNotice('warning' in result && result.warning ? result.warning : null);
                setTyped('');
                setNote('');
              });
            }}
          >
            Reset push
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={shot !== null} onClose={() => setShot(null)} maxWidth="lg">
        <DialogTitle>{shot?.label}</DialogTitle>
        <DialogContent>{shot?.url ? <img src={shot.url} alt={shot.label} style={{ maxWidth: '100%' }} /> : <LinearProgress />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setShot(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function NotLoaded(props: {
  view: IonReportViewDto;
  blockers: IonPreflightIssueDto[];
  mismatchOk: boolean;
  setMismatchOk: (v: boolean) => void;
  itemOverride: string;
  setItemOverride: (v: string) => void;
  canLoad: boolean;
  onLoad: () => void;
}) {
  const { view, blockers } = props;
  const warnings = view.preflight.issues.filter((i) => i.severity === 'warn');
  const needsTick = blockers.some((i) => i.code === 'MISMATCH_UNCONFIRMED');
  const needsItem = blockers.some((i) => i.code === 'ITEM_CODE_MISSING');
  return (
    <>
      {blockers.length > 0 ? (
        <Alert severity="error" icon={false}>
          <AlertTitle>Not ready to load. Still missing:</AlertTitle>
          {blockers.map((i) => (
            <div key={i.code}>• {i.message}</div>
          ))}
        </Alert>
      ) : (
        <Alert severity="success">Everything iON needs is in place. {RUN_MODE_HELP[view.runMode]}</Alert>
      )}
      {warnings.map((i) => (
        <Alert key={i.code} severity="warning">
          {i.message}
        </Alert>
      ))}
      {needsTick && (
        <FormControlLabel
          control={<Checkbox checked={props.mismatchOk} onChange={(e) => props.setMismatchOk(e.target.checked)} />}
          label="I have checked the amount (this imported report's total differs from the Excel sheet's)"
        />
      )}
      <TextField
        size="small"
        label="iON item code (only if different from the material default)"
        value={props.itemOverride}
        onChange={(e) => props.setItemOverride(e.target.value)}
        helperText={needsItem ? 'The main material has no default iON item code: type the code from the PO.' : 'Leave blank to use the material default, e.g. RM-13001.'}
        error={needsItem && props.itemOverride.trim() === ''}
        sx={{ maxWidth: 420 }}
      />
      <Box>
        <Button variant="contained" disabled={!props.canLoad} onClick={props.onLoad}>
          Load on TCS iON
        </Button>
      </Box>
    </>
  );
}

function Loaded(props: { push: IonPushDto; busy: boolean; onRetry: () => void; onContinue: () => void; onReset: () => void; onShot: (id: string, label: string) => void }) {
  const { push } = props;
  const s = STATUS_STYLE[push.status];
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Chip label={ION_PUSH_STATUS_LABELS[push.status]} sx={{ bgcolor: s.bg, color: s.fg, fontWeight: 700 }} />
        {push.ionDnNo ? (
          <Typography sx={{ fontFamily: 'var(--font-numeric)', fontWeight: 700 }}>iON debit note {push.ionDnNo}</Typography>
        ) : (
          <Typography color="text.secondary">No iON number yet</Typography>
        )}
        {push.ionStatus && <Chip size="small" variant="outlined" label={`iON status: ${push.ionStatus}`} />}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          Requested by {push.requestedBy} · {formatDateTime(push.requestedAt)}
          {push.attempts > 0 ? ` · attempt ${push.attempts}` : ''}
        </Typography>
      </Box>

      {push.status === 'CHECK_MANUALLY' && (
        <Alert severity="error">
          <AlertTitle>Check iON by hand before doing anything else</AlertTitle>
          The robot could not confirm what iON saved. Look for a debit note of this supplier invoice in iON. Nothing will be retried automatically.
        </Alert>
      )}
      {push.status === 'DRAFT_CREATED' && !push.active && push.runMode === 'DRAFT_ONLY' && (
        <Alert severity="success">The draft is ready in iON for review. It has not been submitted.</Alert>
      )}
      {push.lastError && (
        <Alert severity={push.status === 'FAILED_RETRYABLE' ? 'warning' : 'error'}>
          <AlertTitle>{push.lastErrorStep ? `Stopped at ${push.lastErrorStep}` : 'Last error'}</AlertTitle>
          {push.lastError}
        </Alert>
      )}

      <Stack direction="row" spacing={1}>
        {push.canRetry && (
          <Button variant="contained" disabled={props.busy} onClick={props.onRetry}>
            {push.ionDnNo ? `Retry (resumes ${push.ionDnNo})` : 'Retry'}
          </Button>
        )}
        {push.canContinue && (
          <Button variant="contained" disabled={props.busy} onClick={props.onContinue}>
            Submit the draft
          </Button>
        )}
        {push.canReset && (
          <Button color="error" disabled={props.busy} onClick={props.onReset}>
            Reset…
          </Button>
        )}
      </Stack>

      {push.screenshots.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            Screenshots
          </Typography>
          {push.screenshots.map((sc) => (
            <Chip key={sc.id} size="small" variant="outlined" label={sc.label} onClick={() => props.onShot(sc.id, sc.label)} />
          ))}
        </Box>
      )}

      <Box sx={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border, #ddd)', borderRadius: 1, p: 1 }}>
        {push.steps.map((st) => (
          <Typography key={st.seq} variant="body2" sx={{ color: st.outcome === 'error' ? '#8A1C1C' : 'text.primary' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{formatDateTime(st.at)}</span> · {st.step}
            {st.message ? `: ${st.message}` : ''}
          </Typography>
        ))}
      </Box>
    </>
  );
}
