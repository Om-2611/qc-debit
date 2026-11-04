import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import GridOnOutlined from '@mui/icons-material/GridOnOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  REPORT_SECTIONS,
  canEditSection,
  canPerformAction,
  type ReportAction,
  type ReportDto,
  type ReportSection,
} from '@dalmia/types';
import { ApiRequestError, downloadFile } from '../../api/client';
import { patchSection, postAction, useLookups, useReport, type WorkflowAction } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { StatusChip } from '../../components/StatusChip';
import { AuditDrawer } from './AuditDrawer';
import { formatDate, formatINR } from '../../lib/format';
import { buildPatch, fromDto, isDirty, liveOutput, type Draft } from './draft';
import { MismatchChip } from './MismatchDrawer';
import { GrnSection } from './sections/GrnSection';
import { HeaderSection } from './sections/HeaderSection';
import { QcSection } from './sections/QcSection';
import { ShortageSection } from './sections/ShortageSection';
import { WeightsSection } from './sections/WeightsSection';

const ACTION_PATH: Record<ReportAction, WorkflowAction> = {
  submitInvoice: 'submit-invoice',
  submitWeights: 'submit-weights',
  submitQc: 'submit-qc',
  submitGrn: 'submit-grn',
  approve: 'approve',
  sendBack: 'send-back',
  reopen: 'reopen',
};

interface Failure {
  message: string;
  details: string[];
}

const toFailure = (err: unknown): Failure => ({
  message: err instanceof ApiRequestError ? err.message : 'Could not reach the server. Your changes are still on this page.',
  details: err instanceof ApiRequestError && Array.isArray(err.details) ? err.details.filter((d): d is string => typeof d === 'string') : [],
});

export function ReportPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const report = useReport(id);
  const lookups = useLookups();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [noteDialog, setNoteDialog] = useState<'sendBack' | 'reopen' | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [note, setNote] = useState('');

  const dto = report.data;
  const saved = useMemo(() => (dto ? fromDto(dto) : null), [dto]);

  // (Re)load the draft whenever the server copy changes — after a save, an action, or a refetch with no local edits.
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  const output = useMemo(() => {
    if (!dto || !draft) return null;
    // Approved reports show their frozen snapshot, never a fresh calculation.
    if (dto.outputIsSnapshot || !lookups.data) return dto.output;
    return liveOutput(draft, lookups.data.engineConfig);
  }, [dto, draft, lookups.data]);

  const dirtySections = useMemo(
    () => (draft && saved ? REPORT_SECTIONS.filter((s) => isDirty(draft, saved, s)) : []),
    [draft, saved],
  );
  const dirty = dirtySections.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (report.isLoading || !user) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: 300 }}>
        <CircularProgress aria-label="Loading report" />
      </Box>
    );
  }
  if (report.error || !dto || !draft || !output) {
    return <Alert severity="error">{report.error?.message ?? 'Report not found.'}</Alert>;
  }

  const can = (section: ReportSection) => canEditSection(user.role, dto.status, section).allowed;
  const may = (action: ReportAction) => canPerformAction(user.role, dto.status, action).allowed;
  const anyEditable = REPORT_SECTIONS.some(can);

  const update = (fn: (d: Draft) => void) =>
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      fn(next);
      return next;
    });

  const accept = (next: ReportDto) => {
    queryClient.setQueryData(['report', id], next);
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  /** Saves each changed section the user owns, in sheet order. Returns the latest server copy, or null on failure. */
  const save = async (): Promise<ReportDto | null> => {
    let latest = dto;
    try {
      for (const section of dirtySections) {
        if (!can(section)) continue;
        latest = await patchSection(id, buildPatch(draft, section, latest.updatedAt));
      }
      accept(latest);
      return latest;
    } catch (err) {
      if (latest !== dto) accept(latest); // keep what did save
      setFailure(toFailure(err));
      return null;
    }
  };

  const run = async (action: ReportAction | 'save', body?: unknown, done?: string) => {
    setBusy(true);
    setFailure(null);
    try {
      const latest = dirty ? await save() : dto;
      if (!latest) return;
      if (action === 'save') {
        setToast('Saved');
        return;
      }
      accept(await postAction(id, ACTION_PATH[action], body));
      setToast(done ?? 'Done');
    } catch (err) {
      setFailure(toFailure(err));
    } finally {
      setBusy(false);
    }
  };

  /** Exports always reflect what is saved on the server, so unsaved edits are saved first. */
  const exportAs = async (kind: 'pdf' | 'xlsx') => {
    setBusy(true);
    setFailure(null);
    try {
      if (dirty && !(await save())) return;
      await downloadFile(`/reports/${id}/export.${kind}`);
    } catch (err) {
      setFailure(toFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const copyNarration = async () => {
    if (!dto.narration) return;
    await navigator.clipboard.writeText(dto.narration);
    setToast('Tally narration copied');
  };

  return (
    <Stack spacing={2} sx={{ pb: 10 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button component={RouterLink} to="/reports" startIcon={<ArrowBackOutlined />} size="small">
          Reports
        </Button>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography className="section-label">QC Report · DPIPL/QA/F-11</Typography>
          <Typography variant="h2">
            {dto.reportNo}
            <Typography component="span" color="text.secondary" sx={{ ml: 1.5, fontWeight: 400 }}>
              {[dto.supplierName ?? dto.partyNameRaw, dto.truckNumber, formatDate(dto.reportDate)].filter(Boolean).join(' · ')}
            </Typography>
          </Typography>
        </Box>
        {dto.source === 'IMPORTED' && <Chip size="small" variant="outlined" label="Imported" />}
        <MismatchChip report={dto} />
        <StatusChip status={dto.status} sentBack={dto.status === 'QC_ENTERED' && !!dto.sentBackNote} />
        <Button size="small" variant="outlined" onClick={() => setAuditOpen(true)}>
          Audit log
        </Button>
      </Box>

      {dto.status === 'QC_ENTERED' && dto.sentBackNote && (
        <Alert severity="warning">
          <AlertTitle>Sent back by the Purchase Manager</AlertTitle>
          {dto.sentBackNote}
        </Alert>
      )}
      {dto.status !== 'APPROVED' && dto.reopenReason && (
        <Alert severity="info">Reopened by an admin: {dto.reopenReason}</Alert>
      )}
      {dto.outputIsSnapshot && (
        <Alert severity="success" icon={false}>
          Approved and locked. The figures below are the snapshot taken at approval and do not change when norms or rates are edited.
        </Alert>
      )}
      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)}>
          <AlertTitle>{failure.message}</AlertTitle>
          {failure.details.length > 0 && (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {failure.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      <HeaderSection
        draft={draft}
        suppliers={lookups.data?.suppliers ?? []}
        editable={can('header')}
        onChange={(patch) => update((d) => Object.assign(d.header, patch))}
      />
      <WeightsSection
        draft={draft}
        output={output}
        invoiceEditable={can('invoiceWeights')}
        dalmiaEditable={can('dalmiaWeights')}
        ratesHidden={!!dto.ratesHidden}
        onChange={(code, key, value) =>
          update((d) => {
            const line = d.materials.find((m) => m.code === code);
            if (line) line[key] = value;
          })
        }
      />
      <QcSection
        draft={draft}
        output={output}
        qcEditable={can('qc')}
        approvalEditable={can('approval')}
        ratesHidden={!!dto.ratesHidden}
        onBaleWeight={(i, v) => update((d) => void (d.baleWeightsKg[i] = v))}
        onReading={(code, i, v) =>
          update((d) => {
            const r = d.readings.find((x) => x.parameterCode === code);
            if (r) r.perBale[i] = v;
          })
        }
        onAdjustment={(code, v) =>
          update((d) => {
            const r = d.readings.find((x) => x.parameterCode === code);
            if (r) r.purchaseAdjustment = v;
          })
        }
        onAffectedBales={(code, v) =>
          update((d) => {
            const r = d.readings.find((x) => x.parameterCode === code);
            if (r) r.affectedBales = v;
          })
        }
      />
      <GrnSection draft={draft} editable={can('grn')} onChange={(v) => update((d) => void (d.header.grnNumber = v))} />
      <ShortageSection
        draft={draft}
        report={dto}
        output={output}
        editable={can('approval')}
        onAdjustment={(code, v) => update((d) => void (d.shortageAdjustments[code] = v))}
        onOtherDescription={(code, v) => update((d) => void (d.otherDescriptions[code] = v))}
        onTolerance={(v) => update((d) => void (d.weightTolerancePercent = v))}
        onRemarks={(v) => update((d) => void (d.remarks = v))}
        ratesHidden={!!dto.ratesHidden}
      />

      {dto.narration && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography className="section-label">Tally narration</Typography>
          <Typography sx={{ mt: 0.5, mb: 1 }}>{dto.narration}</Typography>
          <Button size="small" variant="outlined" startIcon={<ContentCopyOutlined />} onClick={() => void copyNarration()}>
            Copy Tally narration
          </Button>
        </Paper>
      )}

      {/* Action bar: what is offered depends on role and status; the API enforces the same rules. */}
      <Paper
        elevation={6}
        sx={{
          position: 'fixed',
          bottom: 0,
          right: 0,
          left: { xs: 0, md: 216 },
          zIndex: 10,
          px: 3,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
          borderTop: '1px solid var(--border)',
          borderRadius: 0,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 260 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {dto.ratesHidden ? 'Rates and amounts are not shown for your account' : <>Standard {formatINR(output.grandTotal.standardAmount)} · Approved{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{formatINR(output.grandTotal.approvedAmount)}</strong>
            {' · '}Waived {formatINR(output.grandTotal.standardAmount - output.grandTotal.approvedAmount)}</>}
          </Typography>
          <Typography variant="caption" sx={{ color: dirty ? '#7A5200' : 'text.secondary' }}>
            {dirty ? 'Unsaved changes' : anyEditable ? 'All changes saved' : 'Read-only for your role at this stage'}
          </Typography>
        </Box>
        {/* Exports are ADMIN only; the API enforces it. */}
        {user.role === 'ADMIN' && (
          <>
            <Button size="small" startIcon={<PictureAsPdfOutlined />} disabled={busy} onClick={() => void exportAs('pdf')}>
              Export PDF
            </Button>
            <Button size="small" startIcon={<GridOnOutlined />} disabled={busy} onClick={() => void exportAs('xlsx')}>
              Export Excel
            </Button>
          </>
        )}
        {anyEditable && (
          <Button variant="outlined" disabled={busy || !dirty} onClick={() => void run('save')}>
            {dto.status === 'DRAFT' ? 'Save draft' : 'Save'}
          </Button>
        )}
        {may('submitInvoice') && (
          <Button variant="contained" disabled={busy} onClick={() => void run('submitInvoice', undefined, 'Sent to the Raw Material Store')}>
            Submit to RM Store
          </Button>
        )}
        {may('submitWeights') && (
          <Button variant="contained" disabled={busy} onClick={() => void run('submitWeights', undefined, 'Weights submitted to QC')}>
            Submit weights to QC
          </Button>
        )}
        {may('submitQc') && (
          <Button variant="contained" disabled={busy} onClick={() => void run('submitQc', undefined, dto.grnNumber ? 'Submitted for approval' : 'Sent to Stores for the GRN')}>
            Submit QC
          </Button>
        )}
        {may('submitGrn') && (
          <Button variant="contained" disabled={busy} onClick={() => void run('submitGrn', undefined, 'Sent to the Purchase Manager')}>
            Submit GRN to Purchase
          </Button>
        )}
        {may('sendBack') && (
          <Button variant="outlined" disabled={busy} onClick={() => setNoteDialog('sendBack')}>
            Send back
          </Button>
        )}
        {may('approve') && (
          <Button variant="contained" disabled={busy} onClick={() => void run('approve', undefined, 'Report approved')}>
            Approve
          </Button>
        )}
        {/* Imported reports keep the sheet's own figures, so the API refuses to reopen them. */}
        {may('reopen') && dto.source !== 'IMPORTED' && (
          <Button variant="outlined" color="error" disabled={busy} onClick={() => setNoteDialog('reopen')}>
            Reopen
          </Button>
        )}
      </Paper>

      <Dialog open={noteDialog !== null} onClose={() => setNoteDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>{noteDialog === 'reopen' ? 'Reopen approved report' : 'Send back to QC Analyst'}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {noteDialog === 'reopen'
              ? 'The report returns to Pending approval and its figures will be recalculated with today’s norms and rates when it is saved. The reason is recorded in the audit log.'
              : 'Tell the analyst what to check. The report returns to them with this note.'}
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label={noteDialog === 'reopen' ? 'Reason' : 'Note'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNoteDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={noteDialog === 'reopen' ? 'error' : 'primary'}
            disabled={note.trim().length < 3 || busy}
            onClick={() => {
              const action = noteDialog!;
              setNoteDialog(null);
              void run(action, action === 'reopen' ? { reason: note.trim() } : { note: note.trim() }, action === 'reopen' ? 'Report reopened' : 'Sent back');
              setNote('');
            }}
          >
            {noteDialog === 'reopen' ? 'Reopen report' : 'Send back'}
          </Button>
        </DialogActions>
      </Dialog>

      <AuditDrawer reportId={id} open={auditOpen} onClose={() => setAuditOpen(false)} />
      <Snackbar open={toast !== null} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}
