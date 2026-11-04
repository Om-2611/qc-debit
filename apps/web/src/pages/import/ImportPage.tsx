import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRef, useState, type DragEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  IMPORT_MAX_FILE_BYTES,
  type ImportAction,
  type ImportCommitResult,
  type ImportPreviewDto,
  type ImportSheetPreview,
} from '@dalmia/types';
import { ApiRequestError, downloadFile } from '../../api/client';
import { previewImport, useCommitImport } from '../../api/import';
import { useLookups } from '../../api/reports';
import { formatAmount, formatDate, todayIST } from '../../lib/format';
import { PreviousImports } from './PreviousImports';

interface Choice {
  action: ImportAction;
  /** '' = match by name, or create the supplier. */
  supplierId: string;
}

const message = (err: unknown): string => (err instanceof ApiRequestError ? err.message : 'Could not reach the server. Please try again.');
const WARNING_TEXT = '#7A5200'; // dark text on the warning tint, for contrast

/** Admin only: load old workbooks (one tab per truck) as approved, historical reports. */
export function ImportPage() {
  const lookups = useLookups();
  const commit = useCommitImport();
  const input = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [fallbackDate, setFallbackDate] = useState('');
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setPreview(null);
    if (!/\.xlsx$/i.test(file.name)) return setError('Only .xlsx workbooks can be imported. Save older .xls files as .xlsx in Excel first.');
    if (file.size > IMPORT_MAX_FILE_BYTES) return setError(`The file is larger than ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB.`);
    setUploading(true);
    try {
      const parsed = await previewImport(file);
      setPreview(parsed);
      setChoices(Object.fromEntries(parsed.sheets.map((s) => [s.sheetName, { action: s.action, supplierId: '' }])));
      setFallbackDate('');
    } catch (err) {
      setError(message(err));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = ''; // lets the same file be chosen again
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void upload(e.dataTransfer.files[0]);
  };

  const sheets = preview?.sheets.filter((s) => s.isTemplate) ?? [];
  const ignored = preview?.sheets.filter((s) => !s.isTemplate) ?? [];
  const chosen = sheets.filter((s) => choices[s.sheetName]?.action !== 'skip');
  const needsDate = sheets.some((s) => !s.reportDate);
  const dateMissing = chosen.some((s) => !s.reportDate) && !fallbackDate;

  const choose = (sheetName: string, patch: Partial<Choice>) =>
    setChoices((current) => ({ ...current, [sheetName]: { ...current[sheetName]!, ...patch } }));

  const confirm = async () => {
    if (!preview) return;
    setError(null);
    try {
      const done = await commit.mutateAsync({
        previewId: preview.previewId,
        fallbackReportDate: fallbackDate || null,
        sheets: sheets.map((s) => ({ sheetName: s.sheetName, action: choices[s.sheetName]!.action, supplierId: choices[s.sheetName]!.supplierId || null })),
      });
      setResult(done);
      setPreview(null);
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography className="section-label">Import</Typography>
          <Typography variant="h2">Import Excel</Typography>
        </Box>
        <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={() => void downloadFile('/reports/template.xlsx').catch((err) => setError(message(err)))}>
          Download template
        </Button>
      </Box>

      <Paper
        variant="outlined"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        sx={{
          p: 3,
          textAlign: 'center',
          borderStyle: 'dashed',
          borderColor: dragging ? 'var(--brand-primary)' : 'var(--border)',
          bgcolor: dragging ? 'var(--brand-primary-light)' : 'transparent',
        }}
      >
        <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        <Typography sx={{ mb: 0.5 }}>Drop a “Debit Note Format” workbook here — one sheet per truck, or a single sheet.</Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1.5 }}>
          .xlsx only, up to {IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB. Each sheet becomes an approved report that keeps the sheet’s own figures. Nothing is saved until you
          confirm.
        </Typography>
        <Button variant="contained" startIcon={<UploadFileOutlined />} disabled={uploading} onClick={() => input.current?.click()}>
          Choose file
        </Button>
        <Box sx={{ height: 4, mt: 1.5 }}>{uploading && <LinearProgress />}</Box>
      </Paper>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {preview && (
        <Paper variant="outlined" component="section" sx={{ overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, px: 2, pt: 1.5, pb: 1, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 240 }}>
              <Typography className="section-label">Preview</Typography>
              <Typography variant="h4" component="h2">
                {preview.fileName}
              </Typography>
            </Box>
            {needsDate && (
              <TextField
                size="small"
                type="date"
                label="Fallback report date"
                value={fallbackDate}
                onChange={(e) => setFallbackDate(e.target.value)}
                error={dateMissing}
                helperText={dateMissing ? 'Needed: a selected sheet has no date' : 'For sheets that have no date'}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIST() } }}
              />
            )}
          </Box>
          <TableContainer sx={{ borderTop: '1px solid var(--border)' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Sheet</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Truck / GRN / Invoice</TableCell>
                  <TableCell>Party → Supplier</TableCell>
                  <TableCell align="right">Sheet standard ₹</TableCell>
                  <TableCell align="right">Sheet approved ₹</TableCell>
                  <TableCell align="right">App approved ₹</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sheets.map((s) => (
                  <SheetRow key={s.sheetName} sheet={s} choice={choices[s.sheetName]!} suppliers={lookups.data?.suppliers ?? []} onChange={(patch) => choose(s.sheetName, patch)} />
                ))}
                {sheets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                      No sheet of this workbook looks like the QC Report format (“QC Report” near the top and “QC Parameters” in column A).
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
              {chosen.length} of {sheets.length} sheet{sheets.length === 1 ? '' : 's'} selected
              {ignored.length > 0 && ` · not a QC sheet, ignored: ${ignored.map((s) => s.sheetName).join(', ')}`}
            </Typography>
            <Button onClick={() => setPreview(null)} disabled={commit.isPending}>
              Cancel
            </Button>
            <Button variant="contained" disabled={chosen.length === 0 || dateMissing || commit.isPending} onClick={() => void confirm()}>
              Confirm import
            </Button>
          </Box>
          <Box sx={{ height: 4 }}>{commit.isPending && <LinearProgress />}</Box>
        </Paper>
      )}

      {result && <ImportResult result={result} onClose={() => setResult(null)} />}

      <PreviousImports />
    </Stack>
  );
}

interface SheetRowProps {
  sheet: ImportSheetPreview;
  choice: Choice;
  suppliers: { id: string; name: string }[];
  onChange: (patch: Partial<Choice>) => void;
}

function SheetRow({ sheet: s, choice, suppliers, onChange }: SheetRowProps) {
  const blocked = s.errors.length > 0;
  const duplicate = s.duplicates.length > 0;
  const selected = choice.action !== 'skip';

  return (
    <TableRow hover selected={selected} sx={{ verticalAlign: 'top' }}>
      <TableCell padding="checkbox">
        <Checkbox
          size="small"
          checked={selected}
          disabled={blocked}
          onChange={(e) => onChange({ action: e.target.checked ? (duplicate ? 'overwrite' : 'import') : 'skip' })}
          slotProps={{ input: { 'aria-label': `Import sheet ${s.sheetName}` } }}
        />
      </TableCell>
      <TableCell sx={{ fontWeight: 700, color: 'var(--brand-primary)', whiteSpace: 'nowrap' }}>{s.sheetName}</TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{s.reportDate ? formatDate(s.reportDate) : <span style={{ color: WARNING_TEXT }}>No date</span>}</TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <div>{s.truckNumber ?? '—'}</div>
        <Typography variant="caption" color="text.secondary" component="div">
          {[s.grnNumber, s.invoiceNumber].filter(Boolean).join(' · ') || '—'}
        </Typography>
      </TableCell>
      <TableCell sx={{ minWidth: 200 }}>
        <div>{s.partyName ?? '—'}</div>
        {s.supplierMatch ? (
          <Typography variant="caption" color="text.secondary" component="div">
            → {s.supplierMatch.name}
          </Typography>
        ) : (
          s.partyName && (
            <TextField
              select
              size="small"
              fullWidth
              variant="standard"
              value={choice.supplierId}
              disabled={blocked}
              onChange={(e) => onChange({ supplierId: e.target.value })}
              slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': `Supplier for ${s.partyName}` } }}
            >
              <MenuItem value="">Create new supplier</MenuItem>
              {suppliers.map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
            </TextField>
          )
        )}
      </TableCell>
      <TableCell className="num">{formatAmount(s.sheetTotals?.standardAmount)}</TableCell>
      <TableCell className="num">{formatAmount(s.sheetTotals?.approvedAmount)}</TableCell>
      <TableCell className="num" sx={{ whiteSpace: 'nowrap' }}>
        {s.hasMismatch && (
          <Tooltip title="Differs from the sheet by more than ₹1. The sheet’s figures are kept; the report is marked “Mismatch vs. Excel”.">
            <WarningAmberOutlined sx={{ color: 'var(--warning)', fontSize: 18, verticalAlign: 'text-bottom', mr: 0.5 }} />
          </Tooltip>
        )}
        {s.engineTotals ? formatAmount(s.engineTotals.approvedAmount) : '—'}
      </TableCell>
      <TableCell>
        <TextField
          select
          size="small"
          variant="standard"
          value={choice.action}
          disabled={blocked}
          onChange={(e) => onChange({ action: e.target.value as ImportAction })}
          slotProps={{ htmlInput: { 'aria-label': `Action for sheet ${s.sheetName}` } }}
          sx={{ minWidth: 150 }}
        >
          {!duplicate && <MenuItem value="import">Import</MenuItem>}
          <MenuItem value="skip">{duplicate ? 'Skip (already exists)' : 'Skip'}</MenuItem>
          {duplicate && <MenuItem value="overwrite">Overwrite</MenuItem>}
        </TextField>
      </TableCell>
      <TableCell sx={{ fontSize: '0.75rem', minWidth: 260, maxWidth: 420 }}>
        {s.errors.map((e) => (
          <div key={e} style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {e}
          </div>
        ))}
        {duplicate && (
          <div style={{ color: WARNING_TEXT }}>
            Already exists as{' '}
            {s.duplicates.map((d, i) => (
              <span key={d.reportId}>
                {i > 0 && ', '}
                <RouterLink to={`/reports/${d.reportId}`} target="_blank" style={{ color: 'inherit' }}>
                  {d.reportNo}
                </RouterLink>
              </span>
            ))}{' '}
            (same {s.duplicates[0]!.matchedOn === 'GRN' ? 'GRN' : 'truck and invoice number'}). Overwrite deletes it first.
          </div>
        )}
        {s.warnings.map((w) => (
          <div key={w} style={{ color: WARNING_TEXT }}>
            {w}
          </div>
        ))}
      </TableCell>
    </TableRow>
  );
}

const OUTCOME_STYLE = {
  imported: { label: 'Imported', bg: '#E3F1E4', fg: 'var(--success)' },
  skipped: { label: 'Skipped', bg: '#EEEEEE', fg: 'var(--text-secondary)' },
  failed: { label: 'Failed', bg: '#FBE4E4', fg: 'var(--danger)' },
} as const;

function ImportResult({ result, onClose }: { result: ImportCommitResult; onClose: () => void }) {
  return (
    <Paper variant="outlined" component="section" sx={{ overflow: 'hidden' }}>
      <Alert severity={result.errorCount > 0 ? 'warning' : 'success'} onClose={onClose} sx={{ borderRadius: 0 }}>
        <AlertTitle>{result.fileName}</AlertTitle>
        {result.importedCount} imported · {result.skippedCount} skipped · {result.errorCount} failed. The import can be undone below for 24 hours.
      </Alert>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Sheet</TableCell>
              <TableCell>Result</TableCell>
              <TableCell>Report</TableCell>
              <TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.results.map((r) => {
              const style = OUTCOME_STYLE[r.outcome];
              return (
                <TableRow key={r.sheetName}>
                  <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.sheetName}</TableCell>
                  <TableCell>
                    <Chip size="small" label={style.label} sx={{ bgcolor: style.bg, color: style.fg }} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {r.reportId && (
                      <RouterLink to={`/reports/${r.reportId}`} style={{ color: 'var(--brand-primary)', fontWeight: 700 }}>
                        {r.reportNo}
                      </RouterLink>
                    )}
                  </TableCell>
                  <TableCell>
                    {[r.reason, r.overwritten.length > 0 && `Replaced ${r.overwritten.join(', ')}.`, r.hasMismatch && 'Mismatch vs. Excel: the sheet’s figures were kept.']
                      .filter(Boolean)
                      .join(' ')}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
