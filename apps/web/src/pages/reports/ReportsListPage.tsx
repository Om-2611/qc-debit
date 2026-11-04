import AddOutlined from '@mui/icons-material/AddOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
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
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REPORT_STATUSES, STATUS_LABELS, canCreateReport, type ReportListQuery, type ReportStatus } from '@dalmia/types';
import { useLookups, useReportList } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { StatusChip } from '../../components/StatusChip';
import { formatAmount, formatDate } from '../../lib/format';
import { NewReportDialog } from './NewReportDialog';

interface Props {
  /** Fixes the status filter (used by the approval queue). */
  lockedStatus?: ReportStatus;
  label?: string;
  title?: string;
}

export function ReportsListPage({ lockedStatus, label = 'Reports', title = 'All reports' }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<ReportListQuery>({ page: 1, pageSize: 25, status: lockedStatus });
  const [search, setSearch] = useState('');

  // Debounce the free-text search so each keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: search || undefined, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching, error } = useReportList(filters);
  const ratesHidden = !!data?.items.some((r) => r.ratesHidden) || !!(user && user.role !== 'ADMIN' && !user.canSeeRates);
  const set = (patch: Partial<ReportListQuery>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography className="section-label">{label}</Typography>
          <Typography variant="h2">{title}</Typography>
        </Box>
        {user && canCreateReport(user.role) && !lockedStatus && (
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
            New report
          </Button>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <TextField
            label="Search truck, GRN, invoice, report no."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 280, flex: 1 }}
          />
          {!lockedStatus && (
            <TextField
              select
              label="Status"
              value={filters.status ?? ''}
              onChange={(e) => set({ status: (e.target.value || undefined) as ReportStatus | undefined })}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {REPORT_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            select
            label="Supplier"
            value={filters.supplierId ?? ''}
            onChange={(e) => set({ supplierId: e.target.value || undefined })}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All suppliers</MenuItem>
            {lookups.data?.suppliers.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="From"
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => set({ from: e.target.value || undefined })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="To"
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => set({ to: e.target.value || undefined })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
      </Paper>

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
                <TableCell>Invoice No.</TableCell>
                <TableCell>Status</TableCell>
                {!ratesHidden && <TableCell align="right">Standard ₹</TableCell>}
                {!ratesHidden && <TableCell align="right">Approved ₹</TableCell>}
                <TableCell>Source</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  tabIndex={0}
                  onClick={() => navigate(`/reports/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/reports/${r.id}`)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontWeight: 700, color: 'var(--brand-primary)', whiteSpace: 'nowrap' }}>{r.reportNo}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(r.reportDate)}</TableCell>
                  <TableCell>{r.supplierName}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.truckNumber}</TableCell>
                  <TableCell>{r.grnNumber}</TableCell>
                  <TableCell>{r.invoiceNumber}</TableCell>
                  <TableCell>
                    <StatusChip status={r.status} sentBack={r.sentBack} />
                  </TableCell>
                  {!ratesHidden && <TableCell className="num">{formatAmount(r.standardTotal)}</TableCell>}
                  {!ratesHidden && <TableCell className="num">{formatAmount(r.approvedTotal)}</TableCell>}
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Chip size="small" variant="outlined" label={r.source === 'IMPORTED' ? 'Imported' : 'Manual'} />
                      {r.hasMismatch && (
                        <Tooltip title="Mismatch vs. Excel">
                          <WarningAmberOutlined sx={{ color: 'var(--warning)', fontSize: 18 }} />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                    No reports match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={(filters.page ?? 1) - 1}
          rowsPerPage={filters.pageSize ?? 25}
          rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(_e, page) => setFilters((f) => ({ ...f, page: page + 1 }))}
          onRowsPerPageChange={(e) => set({ pageSize: Number(e.target.value) })}
        />
      </Paper>

      <NewReportDialog open={creating} onClose={() => setCreating(false)} />
    </Stack>
  );
}
