import DeleteOutline from '@mui/icons-material/DeleteOutline';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { RateMode, WeightBase } from '@dalmia/calc';
import { RATE_MODES, WEIGHT_BASES, type AdminParameterDto, type NormRuleInput, type RateRuleInput } from '@dalmia/types';
import { errorMessage, useChangeParameter } from '../../api/admin';
import { formatDate, todayIST } from '../../lib/format';
import { RATE_MODE_LABELS, WEIGHT_BASE_LABELS, activeRules } from './parameterWords';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface NormRow {
  seasonStartMonth: number;
  seasonEndMonth: number;
  normPercent: string;
}

interface Props {
  parameter: AdminParameterDto | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Edit a parameter's norms (per season) and its rate rule. Both are saved from a chosen effective date. */
export function ParameterDialog({ parameter, onClose, onDone }: Props) {
  const change = useChangeParameter();
  const [tab, setTab] = useState<'norms' | 'rate'>('norms');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIST());
  const [norms, setNorms] = useState<NormRow[]>([]);
  const [rate, setRate] = useState<{ rateMode: RateMode; fixedRate: string; weightBase: WeightBase; maxActualPercent: string }>({
    rateMode: 'DOMINANT_MATERIAL_RATE',
    fixedRate: '',
    weightBase: 'TOTAL_DALMIA_WEIGHT',
    maxActualPercent: '',
  });
  const [failure, setFailure] = useState<string | null>(null);

  // Start from the rules in force today.
  useEffect(() => {
    if (!parameter) return;
    const today = todayIST();
    setTab('norms');
    setEffectiveFrom(today);
    setFailure(null);
    const active = activeRules(parameter.norms, today);
    setNorms(
      (active.length ? active : [{ seasonStartMonth: 1, seasonEndMonth: 12, normPercent: 0 }]).map((n) => ({
        seasonStartMonth: n.seasonStartMonth,
        seasonEndMonth: n.seasonEndMonth,
        normPercent: String(n.normPercent),
      })),
    );
    const r = activeRules(parameter.rates, today)[0];
    if (r) {
      setRate({
        rateMode: r.rateMode,
        fixedRate: r.fixedRate == null ? '' : String(r.fixedRate),
        weightBase: r.weightBase,
        maxActualPercent: r.maxActualPercent == null ? '' : String(r.maxActualPercent),
      });
    }
  }, [parameter]);

  if (!parameter) return null;

  const saveNorms = async () => {
    setFailure(null);
    const body: NormRuleInput[] = [];
    for (const n of norms) {
      const pct = Number(n.normPercent);
      if (!Number.isFinite(pct)) {
        setFailure('Every norm needs a number.');
        return;
      }
      body.push({ seasonStartMonth: n.seasonStartMonth, seasonEndMonth: n.seasonEndMonth, normPercent: pct, effectiveFrom });
    }
    try {
      await change.mutateAsync({ kind: 'norms', id: parameter.id, body: { norms: body } });
      onDone(`${parameter.name}: norms saved from ${formatDate(effectiveFrom)}`);
      onClose();
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  const saveRate = async () => {
    setFailure(null);
    const fixed = rate.fixedRate.trim() === '' ? null : Number(rate.fixedRate);
    const cutOff = rate.maxActualPercent.trim() === '' ? null : Number(rate.maxActualPercent);
    if ((fixed !== null && !Number.isFinite(fixed)) || (cutOff !== null && !Number.isFinite(cutOff))) {
      setFailure('Enter numbers only.');
      return;
    }
    const body: RateRuleInput = {
      rateMode: rate.rateMode,
      fixedRate: rate.rateMode === 'FIXED' ? fixed : null,
      weightBase: rate.weightBase,
      maxActualPercent: cutOff,
      effectiveFrom,
    };
    try {
      await change.mutateAsync({ kind: 'rate', id: parameter.id, body });
      onDone(`${parameter.name}: rate rule saved from ${formatDate(effectiveFrom)}`);
      onClose();
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  const monthSelect = (value: number, onChange: (m: number) => void, label: string) => (
    <TextField select label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} sx={{ minWidth: 110 }}>
      {MONTHS.map((m, i) => (
        <MenuItem key={m} value={i + 1}>
          {m}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {parameter.name}
        <Typography variant="body2" color="text.secondary">
          Rules apply to reports dated on or after the effective date; earlier reports keep the rules of their own date.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_e, v: 'norms' | 'rate') => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="norms" label="Norms" sx={{ textTransform: 'none', fontWeight: 700 }} />
          <Tab value="rate" label="Rate rule" sx={{ textTransform: 'none', fontWeight: 700 }} />
        </Tabs>
        {failure && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setFailure(null)}>
            {failure}
          </Alert>
        )}
        <TextField
          label="Effective from"
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ mb: 2 }}
        />

        {tab === 'norms' && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Seasons must cover all twelve months exactly once. One row Jan–Dec means the same norm all year.
            </Typography>
            {norms.map((n, i) => (
              <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {monthSelect(n.seasonStartMonth, (m) => setNorms(norms.map((x, j) => (j === i ? { ...x, seasonStartMonth: m } : x))), 'From')}
                {monthSelect(n.seasonEndMonth, (m) => setNorms(norms.map((x, j) => (j === i ? { ...x, seasonEndMonth: m } : x))), 'To')}
                <TextField
                  label="Norm %"
                  value={n.normPercent}
                  onChange={(e) => setNorms(norms.map((x, j) => (j === i ? { ...x, normPercent: e.target.value } : x)))}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                  sx={{ width: 110 }}
                />
                <IconButton aria-label="Remove season" disabled={norms.length === 1} onClick={() => setNorms(norms.filter((_x, j) => j !== i))}>
                  <DeleteOutline />
                </IconButton>
              </Stack>
            ))}
            <Box>
              <Button size="small" onClick={() => setNorms([...norms, { seasonStartMonth: 1, seasonEndMonth: 12, normPercent: '0' }])}>
                Add a season
              </Button>
            </Box>
          </Stack>
        )}

        {tab === 'rate' && (
          <Stack spacing={2}>
            <TextField select label="Rate" value={rate.rateMode} onChange={(e) => setRate({ ...rate, rateMode: e.target.value as RateMode })}>
              {RATE_MODES.map((m) => (
                <MenuItem key={m} value={m}>
                  {RATE_MODE_LABELS[m]}
                </MenuItem>
              ))}
            </TextField>
            {rate.rateMode === 'FIXED' && (
              <TextField
                label="Fixed rate (₹ per kg)"
                value={rate.fixedRate}
                onChange={(e) => setRate({ ...rate, fixedRate: e.target.value })}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            )}
            <TextField select label="Excess % is applied to" value={rate.weightBase} onChange={(e) => setRate({ ...rate, weightBase: e.target.value as WeightBase })}>
              {WEIGHT_BASES.map((b) => (
                <MenuItem key={b} value={b}>
                  {WEIGHT_BASE_LABELS[b]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Charge only while actual % is below (blank = no cut-off)"
              value={rate.maxActualPercent}
              onChange={(e) => setRate({ ...rate, maxActualPercent: e.target.value })}
              helperText="The sheet charges Dirty bottle only below 6%."
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <Divider />
            <FormControlLabel
              control={
                <Switch
                  checked={parameter.isDeductible}
                  onChange={(e) => void change.mutateAsync({ kind: 'fields', id: parameter.id, body: { isDeductible: e.target.checked } }).catch((err) => setFailure(errorMessage(err)))}
                />
              }
              label="Raises a deduction (off = recorded and highlighted only)"
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={change.isPending} onClick={() => void (tab === 'norms' ? saveNorms() : saveRate())}>
          {change.isPending ? 'Saving…' : tab === 'norms' ? 'Save norms' : 'Save rate rule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
