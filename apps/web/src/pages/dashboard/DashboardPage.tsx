import GridOnOutlined from '@mui/icons-material/GridOnOutlined';
import {
  Alert,
  Box,
  Button,
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
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { REPORT_STATUSES, STATUS_LABELS, type DashboardQuery, type ExcelViewQuery, type ReportStatus } from '@dalmia/types';
import { downloadFile } from '../../api/client';
import { toQueryString, useDashboardByParameter, useDashboardBySupplier, useDashboardMonthly, useDashboardSummary, useExcelView } from '../../api/dashboard';
import { useLookups } from '../../api/reports';
import { StatusChip } from '../../components/StatusChip';
import { formatAmount, formatDate, formatINR, formatPercent, formatQty } from '../../lib/format';
import { CHART_SERIES, color } from '../../theme/tokens';

/** ₹ in lakhs/crores for axis ticks: 1,23,456 → "₹ 1.2 L". */
const compactINR = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹ ${(v / 1e7).toFixed(1)} Cr`;
  if (abs >= 1e5) return `₹ ${(v / 1e5).toFixed(1)} L`;
  if (abs >= 1e3) return `₹ ${(v / 1e3).toFixed(0)} K`;
  return `₹ ${v.toFixed(0)}`;
};
const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y?.slice(2)}`;
};
const tooltipMoney = (v: unknown): string => formatINR(typeof v === 'number' ? v : Number(v));

const AXIS = { fontSize: 11, fill: color('--text-secondary') };
const GRID = color('--border');

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 180, flex: 1 }}>
      <Typography className="section-label">{label}</Typography>
      <Typography variant="h3" className="num" sx={{ textAlign: 'left' }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Typography className="section-label" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {empty ? (
        <Box sx={{ height: 240, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>No approved reports in this range.</Box>
      ) : (
        <Box sx={{ height: 240 }}>{children}</Box>
      )}
    </Paper>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const lookups = useLookups();
  const [filters, setFilters] = useState<DashboardQuery>({});
  const [status, setStatus] = useState<ReportStatus | ''>('');
  const excelQuery: ExcelViewQuery = { ...filters, status: status || undefined };

  const summary = useDashboardSummary(filters);
  const bySupplier = useDashboardBySupplier(filters);
  const byParameter = useDashboardByParameter(filters);
  const monthly = useDashboardMonthly(filters);
  const excel = useExcelView(excelQuery);
  const loading = [summary, bySupplier, byParameter, monthly, excel].some((q) => q.isFetching);
  const firstError = [summary, bySupplier, byParameter, monthly, excel].find((q) => q.error)?.error;

  const set = (patch: Partial<DashboardQuery>) => setFilters((f) => ({ ...f, ...patch }));
  const s = summary.data;

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1 }}>
          <Typography className="section-label">Admin</Typography>
          <Typography variant="h2">Dashboard</Typography>
        </Box>
        <Chip size="small" variant="outlined" label="Money figures count approved reports only" />
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <TextField label="From" type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="To" type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField select label="Supplier" value={filters.supplierId ?? ''} onChange={(e) => set({ supplierId: e.target.value || undefined })} sx={{ minWidth: 200 }}>
            <MenuItem value="">All suppliers</MenuItem>
            {lookups.data?.suppliers.map((sp) => (
              <MenuItem key={sp.id} value={sp.id}>
                {sp.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>
      <Box sx={{ height: 4, mt: '-12px !important' }}>{loading && <LinearProgress />}</Box>
      {firstError && <Alert severity="error">{firstError.message}</Alert>}

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Kpi label="Reports this month" value={String(s?.reportsThisMonth ?? '—')} hint="Any status, current month" />
        <Kpi label="Standard deduction" value={s ? formatINR(s.standardTotal) : '—'} hint={s ? `${s.approvedReports} approved reports in range` : undefined} />
        <Kpi label="Approved deduction" value={s ? formatINR(s.approvedTotal) : '—'} />
        <Kpi label="Amount waived" value={s ? formatINR(s.waivedTotal) : '—'} hint="Standard − approved" />
        <Kpi label="Pending approvals" value={String(s?.pendingApprovals ?? '—')} hint="Right now, all dates" />
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <ChartCard title="Approved deduction by supplier" empty={!bySupplier.data?.length}>
          <ResponsiveContainer>
            <BarChart data={bySupplier.data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={compactINR} tick={AXIS} />
              <YAxis type="category" dataKey="supplierName" width={130} tick={AXIS} />
              <Tooltip formatter={tooltipMoney} />
              <Bar dataKey="approvedTotal" name="Approved" fill={CHART_SERIES[0]} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Deduction by parameter — standard vs approved" empty={!byParameter.data?.some((r) => r.standardAmount || r.approvedAmount)}>
          <ResponsiveContainer>
            <BarChart data={byParameter.data?.filter((r) => r.standardAmount || r.approvedAmount)} margin={{ left: 8, right: 16, top: 4, bottom: 40 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 10 }} interval={0} angle={-30} textAnchor="end" />
              <YAxis tickFormatter={compactINR} tick={AXIS} width={64} />
              <Tooltip formatter={tooltipMoney} />
              <Legend verticalAlign="top" height={24} />
              <Bar dataKey="standardAmount" name="Standard" fill={CHART_SERIES[3]} />
              <Bar dataKey="approvedAmount" name="Approved" fill={CHART_SERIES[0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly trend" empty={!monthly.data?.length}>
          <ResponsiveContainer>
            <LineChart data={monthly.data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} />
              <YAxis tickFormatter={compactINR} tick={AXIS} width={64} />
              <Tooltip formatter={tooltipMoney} labelFormatter={(l) => monthLabel(String(l))} />
              <Legend verticalAlign="top" height={24} />
              <Line type="monotone" dataKey="standardTotal" name="Standard" stroke={CHART_SERIES[3]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="approvedTotal" name="Approved" stroke={CHART_SERIES[0]} strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average moisture by month (norm 5% Jul–Sep, 3% otherwise)" empty={!monthly.data?.some((m) => m.averageMoisturePercent != null)}>
          <ResponsiveContainer>
            <LineChart data={monthly.data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} />
              <YAxis tick={AXIS} width={40} unit="%" domain={[0, (max: number) => Math.max(6, Math.ceil(max + 1))]} />
              <Tooltip formatter={(v: unknown) => `${formatPercent(Number(v))} %`} labelFormatter={(l) => monthLabel(String(l))} />
              <ReferenceLine y={5} stroke={color('--warning')} strokeDasharray="4 4" label={{ value: '5%', position: 'right', fontSize: 10 }} />
              <ReferenceLine y={3} stroke={color('--success')} strokeDasharray="4 4" label={{ value: '3%', position: 'right', fontSize: 10 }} />
              <Line type="monotone" dataKey="averageMoisturePercent" name="Avg moisture %" stroke={CHART_SERIES[1]} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', pt: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography className="section-label">Excel view</Typography>
          <Typography variant="h3">One row per report</Typography>
        </Box>
        <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus | '')} sx={{ minWidth: 170 }}>
          <MenuItem value="">All statuses</MenuItem>
          {REPORT_STATUSES.map((st) => (
            <MenuItem key={st} value={st}>
              {STATUS_LABELS[st]}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" startIcon={<GridOnOutlined />} onClick={() => void downloadFile(`/dashboard/excel-view.xlsx${toQueryString(excelQuery)}`)}>
          Export to Excel
        </Button>
      </Box>

      <Paper variant="outlined">
        <TableContainer>
          <Table size="small" sx={{ whiteSpace: 'nowrap' }}>
            <TableHead>
              <TableRow>
                <TableCell>Report No.</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Supplier</TableCell>
                <TableCell>Truck</TableCell>
                <TableCell>GRN</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Invoice kg</TableCell>
                <TableCell align="right">Dalmia kg</TableCell>
                <TableCell align="right">Short kg</TableCell>
                <TableCell align="right">Moisture %</TableCell>
                <TableCell align="right">A) Appr ₹</TableCell>
                <TableCell align="right">B) Appr ₹</TableCell>
                <TableCell align="right">C) Appr ₹</TableCell>
                <TableCell align="right">Standard ₹</TableCell>
                <TableCell align="right">Approved ₹</TableCell>
                <TableCell align="right">Waived ₹</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {excel.data?.rows.map((r) => (
                <TableRow key={r.id} hover onClick={() => navigate(`/reports/${r.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell sx={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{r.reportNo}</TableCell>
                  <TableCell>{formatDate(r.reportDate)}</TableCell>
                  <TableCell>{r.supplierName}</TableCell>
                  <TableCell>{r.truckNumber}</TableCell>
                  <TableCell>{r.grnNumber}</TableCell>
                  <TableCell>
                    <StatusChip status={r.status} />
                  </TableCell>
                  <TableCell className="num">{formatQty(r.totalInvoiceWeightKg)}</TableCell>
                  <TableCell className="num">{formatQty(r.totalDalmiaWeightKg)}</TableCell>
                  <TableCell className={`num ${r.shortfallKg > 0 ? 'negative' : ''}`}>{formatQty(r.shortfallKg)}</TableCell>
                  <TableCell className="num">{r.moistureActualPercent == null ? '' : formatPercent(r.moistureActualPercent)}</TableCell>
                  <TableCell className="num">{formatAmount(r.discretionaryApproved)}</TableCell>
                  <TableCell className="num">{formatAmount(r.nonDiscretionaryApproved)}</TableCell>
                  <TableCell className="num">{formatAmount(r.shortageApproved)}</TableCell>
                  <TableCell className="num">{formatAmount(r.standardTotal)}</TableCell>
                  <TableCell className="num">{formatAmount(r.approvedTotal)}</TableCell>
                  <TableCell className="num">{formatAmount(r.waived)}</TableCell>
                </TableRow>
              ))}
              {excel.data && excel.data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={16} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    No reports match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {excel.data && excel.data.total > excel.data.rows.length && (
          <Typography variant="caption" color="text.secondary" sx={{ p: 1.5, display: 'block' }}>
            Showing {excel.data.rows.length} of {excel.data.total} reports; narrow the filters or use Export to Excel for the full set.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
