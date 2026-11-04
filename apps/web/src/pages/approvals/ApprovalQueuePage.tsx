import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ApiRequestError } from '../../api/client';
import { postAction, useReport, useReportList } from '../../api/reports';
import { formatAmount, formatDate, formatDateTime, formatINR, formatPercent, formatQty } from '../../lib/format';

/** Pending reports for the Purchase Manager, with a side panel comparing Standard and Approved before opening the full report. */
export function ApprovalQueuePage() {
  const { data, isFetching, error } = useReportList({ status: 'PENDING_APPROVAL', page: 1, pageSize: 100 });
  const [selected, setSelected] = useState<string | null>(null);

  const totals = (data?.items ?? []).reduce(
    (a, r) => ({ standard: a.standard + r.standardTotal, approved: a.approved + r.approvedTotal }),
    { standard: 0, approved: 0 },
  );

  return (
    <Stack spacing={2}>
      <Box>
        <Typography className="section-label">Approvals</Typography>
        <Typography variant="h2">Pending approval</Typography>
      </Box>

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {[
          ['Waiting for you', String(data?.total ?? 0)],
          ['Standard deduction', formatINR(totals.standard)],
          ['Approved so far', formatINR(totals.approved)],
          ['Waived so far', formatINR(totals.standard - totals.approved)],
        ].map(([label, value]) => (
          <Paper key={label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 190 }}>
            <Typography className="section-label">{label}</Typography>
            <Typography variant="h3" className="num" sx={{ textAlign: 'left' }}>
              {value}
            </Typography>
          </Paper>
        ))}
      </Stack>

      {error && <Alert severity="error">{error.message}</Alert>}

      <Paper variant="outlined">
        <Box sx={{ height: 4 }}>{isFetching && <LinearProgress />}</Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Report No.</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Supplier</TableCell>
                <TableCell>Truck</TableCell>
                <TableCell>GRN</TableCell>
                <TableCell align="right">Standard ₹</TableCell>
                <TableCell align="right">Approved ₹</TableCell>
                <TableCell align="right">Waived ₹</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  selected={r.id === selected}
                  tabIndex={0}
                  onClick={() => setSelected(r.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(r.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontWeight: 700, color: 'var(--brand-primary)', whiteSpace: 'nowrap' }}>{r.reportNo}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(r.reportDate)}</TableCell>
                  <TableCell>{r.supplierName}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.truckNumber}</TableCell>
                  <TableCell>{r.grnNumber}</TableCell>
                  <TableCell className="num">{formatAmount(r.standardTotal)}</TableCell>
                  <TableCell className="num">{formatAmount(r.approvedTotal)}</TableCell>
                  <TableCell className="num">{formatAmount(r.standardTotal - r.approvedTotal)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                    Nothing is waiting for approval.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Drawer anchor="right" open={selected !== null} onClose={() => setSelected(null)}>
        {selected && <QuickView id={selected} onDone={() => setSelected(null)} />}
      </Drawer>
    </Stack>
  );
}

function QuickView({ id, onDone }: { id: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data: report, isLoading, error } = useReport(id);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string[] | null>(null);

  if (isLoading) {
    return (
      <Box sx={{ width: 560, display: 'grid', placeItems: 'center', height: '100%' }}>
        <CircularProgress aria-label="Loading report" />
      </Box>
    );
  }
  if (error || !report) return <Alert severity="error" sx={{ m: 2, width: 520 }}>{error?.message ?? 'Report not found.'}</Alert>;

  const out = report.output;
  const charged = out.parameters.filter((p) => Math.abs(p.standardAmount) > 0.005 || Math.abs(p.approvedAmount) > 0.005);
  const recordedOnly = out.parameters.filter((p) => p.overNorm && !charged.includes(p));
  const shortage = out.shortage.lines.filter((l) => Math.abs(l.standardAmount) > 0.005 || Math.abs(l.approvedAmount) > 0.005);

  const approve = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await postAction(id, 'approve');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
        queryClient.invalidateQueries({ queryKey: ['report', id] }),
      ]);
      onDone();
    } catch (err) {
      const details = err instanceof ApiRequestError && Array.isArray(err.details) ? err.details.filter((d): d is string => typeof d === 'string') : [];
      setFailure([err instanceof ApiRequestError ? err.message : 'Could not reach the server.', ...details]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ width: { xs: '100vw', sm: 600 }, maxWidth: '100vw', boxSizing: 'border-box', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <Box>
        <Typography className="section-label">Quick view</Typography>
        <Typography variant="h3">{report.reportNo}</Typography>
        <Typography color="text.secondary">
          {[report.supplierName ?? report.partyNameRaw, report.truckNumber, formatDate(report.reportDate)].filter(Boolean).join(' · ')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Checked by {report.checkedBy?.name ?? '—'} · invoice {formatQty(out.weights.totalInvoiceWeight)} kg, received{' '}
          {formatQty(out.weights.totalDalmiaWeight)} kg
        </Typography>
      </Box>

      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)}>
          {failure.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </Alert>
      )}

      <Box sx={{ overflow: 'auto', flex: 1 }}>
        <table className="sheet">
          <thead>
            <tr>
              <th>Deduction</th>
              <th>Actual / Norm %</th>
              <th>Allowed / Adj. kg</th>
              <th>Standard ₹</th>
              <th>Approved ₹</th>
            </tr>
          </thead>
          <tbody>
            {charged.map((p) => (
              <tr key={p.parameterCode}>
                <th scope="row">{p.name}</th>
                <td className="num over-norm">
                  {formatPercent(p.actualPercent)} / {formatPercent(p.normPercent)}
                </td>
                <td className="num">{p.purchaseAdjustment ? formatPercent(p.purchaseAdjustment) : ''}</td>
                <td className="num">{formatAmount(p.standardAmount)}</td>
                <td className="num">{formatAmount(p.approvedAmount)}</td>
              </tr>
            ))}
            {shortage.map((l) => (
              <tr key={l.materialCode}>
                <th scope="row">{l.kind === 'WEIGHT_SHORT' ? 'Weight short' : l.kind === 'EXCESS_GREEN' ? 'Excess Green' : `${l.materialName} short`}</th>
                <td className="num">{formatQty(l.kind === 'WEIGHT_SHORT' ? out.shortage.shortfallTotal : l.shortageQty)} kg</td>
                <td className="num">{l.adjustmentQty ? `${formatQty(l.adjustmentQty)} kg` : ''}</td>
                <td className="num">{formatAmount(l.standardAmount)}</td>
                <td className="num">{formatAmount(l.approvedAmount)}</td>
              </tr>
            ))}
            {charged.length + shortage.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 16 }} className="muted">
                  Nothing to deduct: every parameter is within norm and the weight is within tolerance.
                </td>
              </tr>
            )}
            <tr className="total-row">
              <th scope="row" colSpan={3}>
                Total (A+B+C)
              </th>
              <td className="num">{formatAmount(out.grandTotal.standardAmount)}</td>
              <td className="num">{formatAmount(out.grandTotal.approvedAmount)}</td>
            </tr>
          </tbody>
        </table>

        {recordedOnly.length > 0 && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Above norm but not charged: {recordedOnly.map((p) => `${p.name} (${formatPercent(p.actualPercent)}%)`).join(', ')}.
          </Typography>
        )}
        {report.remarks && (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            <strong>Remarks:</strong> {report.remarks}
          </Typography>
        )}
      </Box>

      <Divider />
      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
        <Button onClick={onDone}>Close</Button>
        <Button component={RouterLink} to={`/reports/${id}`} variant="outlined" startIcon={<OpenInNewOutlined />}>
          Open report
        </Button>
        <Button variant="contained" disabled={busy} onClick={() => void approve()}>
          Approve as shown
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        To enter what purchase allows or send the report back, open it.
      </Typography>
    </Box>
  );
}
