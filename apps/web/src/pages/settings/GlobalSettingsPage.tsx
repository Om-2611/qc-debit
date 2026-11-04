import { Alert, Box, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { SettingsDto } from '@dalmia/types';
import { errorMessage, useSaveSettings, useSettings } from '../../api/admin';

/** Admin → Settings → Global settings: the handful of engine switches that are not per parameter. */
export function GlobalSettingsPage() {
  const { data, isLoading, error } = useSettings();
  const save = useSaveSettings();
  const [form, setForm] = useState<{ tolerancePercent: string; useRow: boolean; allowNegative: boolean; defaultTolerance: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        tolerancePercent: String(Math.round(data.toleranceFraction * 100 * 10000) / 10000),
        useRow: data.useWeightToleranceRow,
        allowNegative: data.allowNegativeOtherShortage,
        defaultTolerance: data.defaultWeightTolerancePercent == null ? '' : String(data.defaultWeightTolerancePercent),
      });
    }
  }, [data]);

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !form) return <Typography color="text.secondary">Loading…</Typography>;

  const submit = async () => {
    setFailure(null);
    setSaved(false);
    const tolerance = Number(form.tolerancePercent);
    const defaultTolerance = form.defaultTolerance.trim() === '' ? null : Number(form.defaultTolerance);
    if (!Number.isFinite(tolerance) || (defaultTolerance !== null && !Number.isFinite(defaultTolerance))) {
      setFailure('Enter numbers only.');
      return;
    }
    const body: Partial<SettingsDto> = {
      toleranceFraction: tolerance / 100,
      useWeightToleranceRow: form.useRow,
      allowNegativeOtherShortage: form.allowNegative,
      defaultWeightTolerancePercent: defaultTolerance,
    };
    try {
      await save.mutateAsync(body);
      setSaved(true);
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Box>
        <Typography className="section-label">Settings · Global</Typography>
        <Typography variant="h2">Global settings</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          These apply to every new calculation. Approved reports keep the figures they were approved with.
        </Typography>
      </Box>

      {failure && <Alert severity="error">{failure}</Alert>}
      {saved && <Alert severity="success">Saved. The live calculation now uses the new values.</Alert>}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2.5}>
          <TextField
            label="Weight shortage tolerance (%)"
            value={form.tolerancePercent}
            onChange={(e) => setForm({ ...form, tolerancePercent: e.target.value })}
            helperText="Weight short is charged when the received weight is below invoice × (100% − this). The Excel sheet hard-codes 0.5%."
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            sx={{ maxWidth: 320 }}
          />
          <FormControlLabel
            control={<Switch checked={form.useRow} onChange={(e) => setForm({ ...form, useRow: e.target.checked })} />}
            label={
              <Box>
                <Typography>Use the report’s “Weight Tolerance” row instead</Typography>
                <Typography variant="caption" color="text.secondary">
                  When on, weight short is charged when the shortfall exceeds the tolerance kg typed on the report (sheet row 50), not the fixed percentage above.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={<Switch checked={form.allowNegative} onChange={(e) => setForm({ ...form, allowNegative: e.target.checked })} />}
            label={
              <Box>
                <Typography>Credit an excess of “Barwaste With Ring” or “Others”</Typography>
                <Typography variant="caption" color="text.secondary">
                  The sheet has no rule for these rows. Off: an excess gives 0. On: an excess produces a negative (credit) line, as the sheet’s formula literally would.
                </Typography>
              </Box>
            }
          />
          <TextField
            label="Default weight tolerance % on new reports"
            value={form.defaultTolerance}
            onChange={(e) => setForm({ ...form, defaultTolerance: e.target.value })}
            helperText="Pre-fills row 50 on every new report. Leave blank to leave the row empty."
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            sx={{ maxWidth: 320 }}
          />
          <Box>
            <Button variant="contained" onClick={() => void submit()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
}
