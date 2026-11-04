import { Alert, AlertTitle, Box, Button, Chip, LinearProgress, Paper, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useState } from 'react';
import type { AdminParameterDto } from '@dalmia/types';
import { errorMessage, useAdminParameters, useChangeParameter } from '../../api/admin';
import { todayIST } from '../../lib/format';
import { ParameterDialog } from './ParameterDialog';
import { activeRules, changeNote, nextChange, normsInWords, rateInWords } from './parameterWords';

const CATEGORY_LABELS = { DISCRETIONARY: 'A) Discretionary', NON_DISCRETIONARY: 'B) Non-discretionary' } as const;
const INPUT_LABELS = { KG_PER_BALE: 'kg per bale', PERCENT_PER_BALE: '% per bale' } as const;

/** Admin → Settings → Parameters: one row per QC parameter with the norm and rate rule in force today, in words. */
export function ParametersPage() {
  const { data, isFetching, error } = useAdminParameters();
  const change = useChangeParameter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const today = todayIST();
  const editing = data?.find((p) => p.id === editingId) ?? null;

  const toggleDeductible = async (p: AdminParameterDto, isDeductible: boolean) => {
    setFailure(null);
    try {
      await change.mutateAsync({ kind: 'fields', id: p.id, body: { isDeductible } });
      setToast(isDeductible ? `${p.name} now raises a deduction` : `${p.name} is recorded only`);
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography className="section-label">Settings · Parameters</Typography>
        <Typography variant="h2">QC parameters, norms and rates</Typography>
      </Box>

      <Alert severity="warning">
        <AlertTitle>These defaults reproduce the client’s Excel</AlertTitle>
        Every norm, rate rule and “deductible” switch below matches a formula in “Debit Note Format.xlsx”. Changing one makes the
        app’s figures differ from the workbook (the Excel export flags the difference in cell V10). Approved reports keep the
        snapshot taken at approval; reports still in progress are recalculated with the new rule the next time they are saved.
      </Alert>
      {(error || failure) && (
        <Alert severity="error" onClose={failure ? () => setFailure(null) : undefined}>
          {failure ?? error?.message}
        </Alert>
      )}

      <Paper variant="outlined">
        <Box sx={{ height: 4 }}>{(isFetching || change.isPending) && <LinearProgress />}</Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Parameter</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Input</TableCell>
                <TableCell>Norm in force</TableCell>
                <TableCell>Rate rule in force</TableCell>
                <TableCell>Deductible</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.map((p) => (
                <TableRow key={p.id} hover sx={{ opacity: p.isActive ? 1 : 0.6 }}>
                  <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {p.name}
                    {!p.isActive && <Chip size="small" label="Switched off" sx={{ ml: 1, bgcolor: '#EEEEEE', color: 'var(--text-secondary)' }} />}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{CATEGORY_LABELS[p.category]}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{INPUT_LABELS[p.inputMode]}</TableCell>
                  <TableCell>
                    {normsInWords(activeRules(p.norms, today))}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {changeNote(nextChange(p.norms, today))}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ color: p.isDeductible ? undefined : 'text.secondary' }}>
                    {rateInWords(activeRules(p.rates, today)[0])}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {changeNote(nextChange(p.rates, today))}
                      {!p.isDeductible && ' — not applied: recorded only'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={p.isDeductible}
                      disabled={change.isPending}
                      onChange={(_e, checked) => void toggleDeductible(p, checked)}
                      slotProps={{ input: { 'aria-label': `${p.name} deductible` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setEditingId(p.id)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Typography variant="caption" color="text.secondary">
        “Deductible” off = the reading is recorded and highlighted when above norm but never raises an amount (the sheet has no
        formula for Non Food Grade-PET and Metal).
      </Typography>

      <ParameterDialog parameter={editing} onClose={() => setEditingId(null)} onDone={setToast} />
      <Snackbar open={toast !== null} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}
