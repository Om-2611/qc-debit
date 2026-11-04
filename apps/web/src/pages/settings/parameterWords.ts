import { seasonLabel, type RateMode, type WeightBase } from '@dalmia/calc';
import type { NormRuleDto, RateRuleDto } from '@dalmia/types';
import { formatDate } from '../../lib/format';

export const RATE_MODE_LABELS: Record<RateMode, string> = {
  DOMINANT_MATERIAL_RATE: 'Dominant material rate',
  DOMINANT_MATERIAL_RATE_MINUS_20: 'Dominant material rate − 20',
  CLEAR_RATE_MINUS_20: 'Clear rate − 20',
  FIXED: 'Fixed ₹ per kg',
};

export const WEIGHT_BASE_LABELS: Record<WeightBase, string> = {
  TOTAL_DALMIA_WEIGHT: 'Total Dalmia weight',
  CLEAR_WEIGHT: 'Clear weight',
  AFFECTED_BALES_TRUCK_AVG: 'No. of bales affected × average truck bale weight',
  AFFECTED_BALES_SAMPLE_AVG: 'No. of bales affected × average sample bale weight',
};

const BASE_WORDS: Record<WeightBase, string> = {
  TOTAL_DALMIA_WEIGHT: 'on total Dalmia weight',
  CLEAR_WEIGHT: 'on Clear weight',
  AFFECTED_BALES_TRUCK_AVG: 'per affected bale × avg truck bale weight',
  AFFECTED_BALES_SAMPLE_AVG: 'per affected bale × avg sample bale weight',
};

const trim = (v: number): string => String(Number(v.toFixed(4)));

/** The rules in force on `today`: those sharing the latest effective date that has been reached. */
export function activeRules<T extends { effectiveFrom: string }>(rules: T[], today: string): T[] {
  const reached = rules.filter((r) => r.effectiveFrom <= today).map((r) => r.effectiveFrom).sort();
  const latest = reached.at(-1);
  return latest ? rules.filter((r) => r.effectiveFrom === latest) : [];
}

/** Earliest effective date still to come, if any. */
export const nextChange = (rules: { effectiveFrom: string }[], today: string): string | null =>
  rules.map((r) => r.effectiveFrom).filter((d) => d > today).sort()[0] ?? null;

/** "Jul–Sep 5% · Oct–Jun 3%" or "All year 2%". */
export function normsInWords(norms: NormRuleDto[]): string {
  if (norms.length === 0) return 'No norm (treated as 0%)';
  return [...norms]
    // Monsoon first, as the sheet lists it.
    .sort((a, b) => ((a.seasonStartMonth + 5) % 12) - ((b.seasonStartMonth + 5) % 12))
    .map((n) => `${seasonLabel(n.seasonStartMonth, n.seasonEndMonth) || 'All year'} ${trim(n.normPercent)}%`)
    .join(' · ');
}

/** "Dominant material rate on total Dalmia weight", "Fixed ₹10 per affected bale × avg truck bale weight, charged below 6%". */
export function rateInWords(rate: RateRuleDto | undefined): string {
  if (!rate) return 'No rate rule (dominant material rate on total Dalmia weight)';
  const mode = rate.rateMode === 'FIXED' ? `Fixed ₹${trim(rate.fixedRate ?? 0)}` : RATE_MODE_LABELS[rate.rateMode];
  const cutOff = rate.maxActualPercent != null ? `, charged below ${trim(rate.maxActualPercent)}%` : '';
  return `${mode} ${BASE_WORDS[rate.weightBase]}${cutOff}`;
}

export const changeNote = (date: string | null): string => (date ? ` (changes on ${formatDate(date)})` : '');
