import { Alert, Box, CircularProgress, Drawer, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import type { AuditEntryDto } from '@dalmia/types';
import { useReportAudit } from '../../api/reports';
import { formatDateTime } from '../../lib/format';

const ACTION_WORDS: Record<string, string> = {
  REPORT_CREATE: 'Created',
  FIELD_CHANGE: 'Changed',
  STATUS_CHANGE: 'Status',
  SEND_BACK: 'Sent back',
  REOPEN: 'Reopened',
  EXPORT_PDF: 'Exported PDF',
  EXPORT_EXCEL: 'Exported Excel',
  REPORT_SEED: 'Seeded',
  IMPORT_COMMIT: 'Imported',
  IMPORT_OVERWRITE: 'Replaced by import',
};

const HEADER_WORDS: Record<string, string> = {
  reportDate: 'Report date',
  supplierId: 'Supplier',
  partyNameRaw: 'Party name',
  poNumber: 'PO No.',
  truckNumber: 'Truck No.',
  grnNumber: 'GRN No.',
  tokenDate: 'Token Dt.',
  tokenNumber: 'Token No.',
  invoiceNumber: 'Invoice No.',
  invoiceDate: 'Invoice Dt.',
  weightTolerancePercent: 'Weight tolerance %',
  remarks: 'Remarks',
  status: 'Status',
  sentBackNote: 'Send-back note',
  reopenReason: 'Reopen reason',
};

const WEIGHT_WORDS: Record<string, string> = {
  invoiceWeightKg: 'Invoice weight (kg)',
  invoiceBales: 'Invoice no. of bales',
  invoiceRate: 'Invoice rate',
  dalmiaWeightKg: 'Dalmia weight (kg)',
  dalmiaBales: 'Dalmia no. of bales',
  dalmiaRate: 'Dalmia rate',
};

const titleCase = (code: string): string =>
  code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** `weights.CLEAR.dalmiaWeightKg` → "Clear · Dalmia weight (kg)"; `reading.MOISTURE.bale1` → "Moisture · bale 1". */
function fieldWords(field: string | null): string {
  if (!field) return '';
  const [kind, code, rest] = field.split('.');
  switch (kind) {
    case 'weights':
      return `${titleCase(code ?? '')} · ${WEIGHT_WORDS[rest ?? ''] ?? rest}`;
    case 'bale':
      return `Bale ${code} weight (kg)`;
    case 'reading':
      return `${titleCase(code ?? '')} · ${(rest ?? '').replace('bale', 'bale ')}`;
    case 'purchaseAdjustment':
      return `${titleCase(code ?? '')} · purchase allowed`;
    case 'affectedBales':
      return `${titleCase(code ?? '')} · no. of bales affected`;
    case 'shortageAdjustment':
      return `${titleCase(code ?? '')} · shortage adjustment (kg)`;
    case 'otherDescription':
      return `${titleCase(code ?? '')} · description`;
    default:
      return HEADER_WORDS[field] ?? field;
  }
}

const value = (v: string | null): string => (v === null || v === '' ? '—' : v);

function Entry({ e }: { e: AuditEntryDto }) {
  const change = e.action === 'FIELD_CHANGE' || e.action === 'STATUS_CHANGE';
  return (
    <Box sx={{ py: 1, borderBottom: '1px solid var(--border)' }}>
      <Typography variant="caption" color="text.secondary">
        {formatDateTime(e.at)} · {e.user.name}
      </Typography>
      <Typography variant="body2">
        <strong>{ACTION_WORDS[e.action] ?? titleCase(e.action)}</strong>
        {e.field && <> · {fieldWords(e.field)}</>}
        {change && (
          <>
            : <span className="num" style={{ textAlign: 'left' }}>{value(e.oldValue)}</span> → <span className="num" style={{ textAlign: 'left', fontWeight: 700 }}>{value(e.newValue)}</span>
          </>
        )}
        {!change && e.newValue && <>: {e.newValue}</>}
      </Typography>
    </Box>
  );
}

/** Every change to the report, newest first, from GET /api/reports/:id/audit. */
export function AuditDrawer({ reportId, open, onClose }: { reportId: string; open: boolean; onClose: () => void }) {
  const { data, isLoading, error } = useReportAudit(reportId, open);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data;
    return data.filter((e) =>
      [e.user.name, e.action, fieldWords(e.field), e.oldValue ?? '', e.newValue ?? ''].join(' ').toLowerCase().includes(q),
    );
  }, [data, filter]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 520 }, maxWidth: '100vw', boxSizing: 'border-box', p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Typography className="section-label">Audit log</Typography>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          Who changed what
        </Typography>
        <TextField label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ mb: 1 }} />
        {error && <Alert severity="error">{error.message}</Alert>}
        {isLoading && <CircularProgress size={24} sx={{ my: 2 }} aria-label="Loading audit log" />}
        <Box sx={{ overflow: 'auto', flex: 1 }}>
          {rows.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
          {data && rows.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              Nothing matches.
            </Typography>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ pt: 1 }}>
          {data ? `${rows.length} of ${data.length} entries` : ''}
        </Typography>
      </Box>
    </Drawer>
  );
}
