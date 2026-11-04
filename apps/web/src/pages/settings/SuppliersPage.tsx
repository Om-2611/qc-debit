import { zodResolver } from '@hookform/resolvers/zod';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { AdminSupplierDto } from '@dalmia/types';
import { errorMessage, useAdminSuppliers, useSaveSupplier } from '../../api/admin';
import { formatDate } from '../../lib/format';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  code: z.string().trim().min(1, 'Code is required').max(30),
  gstin: z.string().trim().max(20),
  address: z.string().trim().max(500),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof schema>;
const BLANK: FormValues = { name: '', code: '', gstin: '', address: '', isActive: true };

/** Admin → Settings → Suppliers. Reports reference suppliers, so a supplier is deactivated, never deleted. */
export function SuppliersPage() {
  const { data, isFetching, error } = useAdminSuppliers();
  const [search, setSearch] = useState('');
  // undefined = dialog closed, null = new supplier
  const [editing, setEditing] = useState<AdminSupplierDto | null | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const needle = search.trim().toLowerCase();
  const rows = (data ?? []).filter((s) => !needle || [s.name, s.code, s.gstin ?? ''].some((v) => v.toLowerCase().includes(needle)));

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography className="section-label">Settings · Suppliers</Typography>
          <Typography variant="h2">Suppliers</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Inactive suppliers no longer appear when a report is created; their existing reports are untouched.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing(null)}>
          New supplier
        </Button>
      </Box>

      {error && <Alert severity="error">{error.message}</Alert>}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <TextField label="Search name, code, GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 280 }} />
      </Paper>

      <Paper variant="outlined">
        <Box sx={{ height: 4 }}>{isFetching && <LinearProgress />}</Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>GSTIN</TableCell>
                <TableCell>Address</TableCell>
                <TableCell align="right">Reports</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id} hover sx={{ opacity: s.isActive ? 1 : 0.6 }}>
                  <TableCell sx={{ fontWeight: 700 }}>{s.name}</TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-numeric)', fontSize: '0.8rem' }}>{s.code}</TableCell>
                  <TableCell sx={{ fontFamily: 'var(--font-numeric)', fontSize: '0.8rem' }}>{s.gstin}</TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>{s.address}</TableCell>
                  <TableCell className="num">{s.reportCount}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={s.isActive ? 'Active' : 'Inactive'}
                      sx={s.isActive ? { bgcolor: '#E3F1E4', color: 'var(--success)' } : { bgcolor: '#EEEEEE', color: 'var(--text-secondary)' }}
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(s.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                    {data.length === 0 ? 'No suppliers yet. Add the first one, or let the Gate type party names freely.' : 'No supplier matches the search.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <SupplierDialog supplier={editing} onClose={() => setEditing(undefined)} onDone={setToast} />
      <Snackbar open={toast !== null} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}

function SupplierDialog({ supplier, onClose, onDone }: { supplier: AdminSupplierDto | null | undefined; onClose: () => void; onDone: (message: string) => void }) {
  const save = useSaveSupplier();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, reset, formState } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: BLANK });

  useEffect(() => {
    if (supplier === undefined) return;
    setError(null);
    reset(supplier ? { name: supplier.name, code: supplier.code, gstin: supplier.gstin ?? '', address: supplier.address ?? '', isActive: supplier.isActive } : BLANK);
  }, [supplier, reset]);

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const saved = await save.mutateAsync({ id: supplier?.id ?? null, body: v });
      onClose();
      onDone(`${saved.name} ${supplier ? 'saved' : 'created'}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the supplier.'));
    }
  });
  const e = formState.errors;

  return (
    <Dialog open={supplier !== undefined} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>{supplier ? 'Edit supplier' : 'New supplier'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name" autoFocus error={!!e.name} helperText={e.name?.message ?? 'Must be unique.'} {...register('name')} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Code"
                error={!!e.code}
                helperText={e.code?.message ?? 'Short unique code; saved in capitals.'}
                slotProps={{ htmlInput: { style: { textTransform: 'uppercase' } } }}
                sx={{ flex: 1 }}
                {...register('code')}
              />
              <TextField label="GSTIN" error={!!e.gstin} helperText={e.gstin?.message ?? 'Optional'} sx={{ flex: 1 }} {...register('gstin')} />
            </Stack>
            <TextField label="Address" multiline minRows={2} error={!!e.address} helperText={e.address?.message ?? 'Optional'} {...register('address')} />
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(_e, checked) => field.onChange(checked)} />}
                  label={field.value ? 'Active: offered when a report is created' : 'Inactive: hidden from new reports'}
                />
              )}
            />
            {supplier && supplier.reportCount > 0 && (
              <Typography variant="caption" color="text.secondary">
                {supplier.reportCount} report{supplier.reportCount === 1 ? '' : 's'} reference this supplier, so it cannot be deleted; deactivate it instead.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
