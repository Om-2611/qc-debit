import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import type { SupplierDto } from '@dalmia/types';
import { ApiRequestError } from '../../api/client';
import { useCreateReport, useLookups } from '../../api/reports';
import { todayIST } from '../../lib/format';

const schema = z.object({
  reportDate: z.string().min(1, 'Report date is required'),
  // A supplier picked from the list, or a party name typed freely when it is not in the list yet.
  party: z.union([z.string(), z.custom<SupplierDto>((v) => typeof v === 'object' && v !== null)]).nullable(),
  truckNumber: z.string().trim().max(30),
  invoiceNumber: z.string().trim().max(60),
});
type FormValues = z.infer<typeof schema>;

export function NewReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const lookups = useLookups();
  const create = useCreateReport();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reportDate: todayIST(), party: null, truckNumber: '', invoiceNumber: '' },
  });

  const close = () => {
    reset();
    setError(null);
    onClose();
  };

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const report = await create.mutateAsync({
        reportDate: v.reportDate,
        supplierId: typeof v.party === 'object' && v.party ? v.party.id : null,
        partyNameRaw: typeof v.party === 'string' ? v.party : (v.party?.name ?? null),
        truckNumber: v.truckNumber,
        invoiceNumber: v.invoiceNumber,
      });
      close();
      navigate(`/reports/${report.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the report.');
    }
  });

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <form onSubmit={submit} noValidate>
        <DialogTitle>New report</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Report date"
              type="date"
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!formState.errors.reportDate}
              helperText={formState.errors.reportDate?.message ?? 'Decides the seasonal norms (Jul–Sep vs. rest of year).'}
              {...register('reportDate')}
            />
            <Controller
              control={control}
              name="party"
              render={({ field }) => (
                <Autocomplete
                  freeSolo
                  autoSelect
                  options={lookups.data?.suppliers ?? []}
                  getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
                  value={field.value}
                  onChange={(_e, value) => field.onChange(value)}
                  renderInput={(params) => (
                    <TextField {...params} label="Party name" helperText="Pick a supplier, or type the name if it is not listed." autoFocus />
                  )}
                />
              )}
            />
            <TextField label="Truck No." {...register('truckNumber')} />
            <TextField label="Invoice No." {...register('invoiceNumber')} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Creating…' : 'Create report'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
