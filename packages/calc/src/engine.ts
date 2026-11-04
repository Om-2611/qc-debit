import { monthInSeason, seasonLabel, seasonLength, toYMD, ymdKey } from './dates';
import type {
  DateLike,
  DeductionAmounts,
  EngineConfig,
  EngineOutput,
  MaterialInput,
  NormRule,
  ParameterConfig,
  ParameterResult,
  RateRule,
  ReportInput,
  ShortageLineResult,
  ShortageResult,
  WeightResult,
} from './types';
import { MATERIAL_CODES, usesAffectedBales } from './types';

/** Absorbs binary floating-point noise in the weight-tolerance comparison (kg). */
const WEIGHT_EPSILON_KG = 1e-6;

/** Blank / non-numeric → 0, like an empty Excel cell in arithmetic. */
const n = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

const isFilled = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  // +EPSILON so 1.005 → 1.01 rather than 1.00.
  const r = Math.round((value + Math.sign(value) * Number.EPSILON) * f) / f;
  return r === 0 ? 0 : r;
}

// ---------------------------------------------------------------- 5.2 weight block

export function computeWeights(materials: MaterialInput[]): WeightResult {
  const totalInvoiceWeight = sum(materials.map((m) => n(m.invoiceWeightKg)));
  const totalDalmiaWeight = sum(materials.map((m) => n(m.dalmiaWeightKg)));

  // Excel: INDEX(rates, MATCH(MAX(dalmia weights), dalmia weights, 0)) — first column wins a tie.
  let dominant: MaterialInput | null = null;
  for (const m of materials) {
    if (dominant === null || n(m.dalmiaWeightKg) > n(dominant.dalmiaWeightKg)) dominant = m;
  }

  const clear = materials.find((m) => m.code === MATERIAL_CODES.CLEAR);
  const totalDalmiaBales = sum(materials.map((m) => n(m.dalmiaBales)));

  return {
    totalInvoiceWeight,
    totalDalmiaWeight,
    totalInvoiceBales: sum(materials.map((m) => n(m.invoiceBales))),
    totalDalmiaBales,
    differences: materials.map((m) => ({
      materialCode: m.code,
      materialName: m.name,
      differenceKg: n(m.dalmiaWeightKg) - n(m.invoiceWeightKg),
    })),
    totalDifference: totalDalmiaWeight - totalInvoiceWeight,
    dominantMaterialCode: dominant?.code ?? null,
    dominantRate: n(dominant?.dalmiaRate),
    clearWeight: n(clear?.dalmiaWeightKg),
    clearRate: n(clear?.dalmiaRate),
    averageTruckBaleWeight: totalDalmiaBales > 0 ? totalDalmiaWeight / totalDalmiaBales : 0,
  };
}

// ---------------------------------------------------------------- 5.4 norm / rate selection

function isEffective(effectiveFrom: DateLike | null | undefined, reportKey: number): boolean {
  return effectiveFrom == null || ymdKey(effectiveFrom) <= reportKey;
}

const effectiveKey = (d: DateLike | null | undefined): number => (d == null ? 0 : ymdKey(d));

/** Latest effective rule whose season contains the report month; a narrower season beats a wider one. */
export function selectNorm(norms: NormRule[], reportDate: DateLike): NormRule | null {
  const { month } = toYMD(reportDate);
  const reportKey = ymdKey(reportDate);
  const candidates = norms
    .filter((r) => isEffective(r.effectiveFrom, reportKey))
    .filter((r) => monthInSeason(month, r.seasonStartMonth, r.seasonEndMonth))
    .sort(
      (a, b) =>
        effectiveKey(b.effectiveFrom) - effectiveKey(a.effectiveFrom) ||
        seasonLength(a.seasonStartMonth, a.seasonEndMonth) -
          seasonLength(b.seasonStartMonth, b.seasonEndMonth),
    );
  return candidates[0] ?? null;
}

export function selectRate(rates: RateRule[], reportDate: DateLike): RateRule | null {
  const reportKey = ymdKey(reportDate);
  const candidates = rates
    .filter((r) => isEffective(r.effectiveFrom, reportKey))
    .sort((a, b) => effectiveKey(b.effectiveFrom) - effectiveKey(a.effectiveFrom));
  return candidates[0] ?? null;
}

function resolveRate(rule: RateRule | null, weights: WeightResult): number {
  const { dominantRate } = weights;
  if (!rule) return dominantRate;
  switch (rule.rateMode) {
    case 'FIXED':
      return n(rule.fixedRate);
    case 'DOMINANT_MATERIAL_RATE_MINUS_20':
      return dominantRate - 20;
    case 'CLEAR_RATE_MINUS_20':
      return weights.clearRate - 20;
    case 'DOMINANT_MATERIAL_RATE':
    default:
      return dominantRate;
  }
}

// ---------------------------------------------------------------- 5.3 + 5.5 parameters

function computeParameter(
  param: ParameterConfig,
  input: ReportInput,
  weights: WeightResult,
  totalBaleWeight: number,
): ParameterResult {
  const reading = input.readings.find((r) => r.parameterCode === param.code);
  const perBale = reading?.perBale ?? [];
  const baleCount = Math.max(perBale.length, input.baleWeightsKg.length);

  let balePercents: (number | null)[];
  let totalKg: number | null;
  let actualPercent: number;

  if (param.inputMode === 'PERCENT_PER_BALE') {
    // L26 = AVERAGE(E26:J26): simple mean of the non-blank readings.
    const filled = perBale.filter(isFilled);
    balePercents = Array.from({ length: baleCount }, (_, i) => (isFilled(perBale[i]) ? perBale[i]! : null));
    totalKg = null;
    actualPercent = filled.length ? sum(filled) / filled.length : 0;
  } else {
    balePercents = Array.from({ length: baleCount }, (_, i) => {
      const kg = perBale[i];
      if (!isFilled(kg)) return null;
      const baleWeight = n(input.baleWeightsKg[i]);
      return baleWeight > 0 ? (kg / baleWeight) * 100 : 0;
    });
    totalKg = sum(perBale.map(n));
    // Column L "Average" is weight-weighted: Σkg ÷ Σbale weight, not the mean of the bale %.
    actualPercent = totalBaleWeight > 0 ? (totalKg / totalBaleWeight) * 100 : 0;
  }

  const norm = selectNorm(param.norms, input.reportDate);
  const normPercent = n(norm?.normPercent);
  const rateRule = selectRate(param.rates, input.reportDate);
  const weightBase = rateRule?.weightBase ?? 'TOTAL_DALMIA_WEIGHT';
  const affectedBales = usesAffectedBales(weightBase) && isFilled(reading?.affectedBales) ? reading.affectedBales : null;
  const filledBaleWeights = input.baleWeightsKg.filter(isFilled);
  const weightBaseKg = ((): number => {
    switch (weightBase) {
      case 'CLEAR_WEIGHT':
        return weights.clearWeight;
      case 'AFFECTED_BALES_TRUCK_AVG':
        return n(affectedBales) * weights.averageTruckBaleWeight;
      case 'AFFECTED_BALES_SAMPLE_AVG':
        return n(affectedBales) * (filledBaleWeights.length ? sum(filledBaleWeights) / filledBaleWeights.length : 0);
      default:
        return weights.totalDalmiaWeight;
    }
  })();
  const rate = resolveRate(rateRule, weights);
  const purchaseAdjustment = n(reading?.purchaseAdjustment);

  // Standard: IF(L>D, (L−D)%×base, 0) — the sheet's formula from the norm.
  // Approved: (purchase allowed − norm)% × total Dalmia weight (M18) × rate, per the client (2026-09-23).
  // Purchase allowed (column N) is the total % accepted, e.g. 7 against a norm of 5; blank or at the norm gives 0.
  // It is capped between the norm (D) and the actual % (L); the API refuses values outside that range.
  const overNorm = actualPercent > normPercent;
  const excess = overNorm ? actualPercent - normPercent : 0;
  const approvedFromPercent = Math.min(Math.max(purchaseAdjustment, normPercent), Math.max(actualPercent, normPercent));
  const approvedExcess = approvedFromPercent - normPercent;
  const beyondCutOff = rateRule?.maxActualPercent != null && actualPercent >= rateRule.maxActualPercent;

  const standardQty = param.isDeductible ? (excess / 100) * weightBaseKg : 0;
  const approvedQty = param.isDeductible ? (approvedExcess / 100) * weights.totalDalmiaWeight : 0;
  // Sheet Q28 applies the cut-off to the amount only; the quantity column (P28) is still shown.
  const standardAmount = beyondCutOff ? 0 : standardQty * rate;
  const approvedAmount = beyondCutOff ? 0 : approvedQty * rate;

  return {
    parameterCode: param.code,
    name: param.name,
    category: param.category,
    inputMode: param.inputMode,
    sortOrder: param.sortOrder,
    isDeductible: param.isDeductible,
    normPercent,
    normSeasonLabel: norm ? seasonLabel(norm.seasonStartMonth, norm.seasonEndMonth) : '',
    balePercents,
    totalKg,
    actualPercent,
    overNorm,
    purchaseAdjustment,
    approvedFromPercent,
    rate,
    weightBase,
    weightBaseKg,
    affectedBales,
    beyondCutOff,
    standardQty,
    standardAmount,
    approvedQty,
    approvedAmount,
    differenceQty: approvedQty - standardQty,
    differenceAmount: approvedAmount - standardAmount,
  };
}

function sumDeductions(rows: DeductionAmounts[]): DeductionAmounts {
  return {
    standardQty: sum(rows.map((r) => r.standardQty)),
    standardAmount: sum(rows.map((r) => r.standardAmount)),
    approvedQty: sum(rows.map((r) => r.approvedQty)),
    approvedAmount: sum(rows.map((r) => r.approvedAmount)),
    differenceQty: sum(rows.map((r) => r.differenceQty)),
    differenceAmount: sum(rows.map((r) => r.differenceAmount)),
  };
}

// ---------------------------------------------------------------- 5.6 shortage block

const SHORTAGE_ORDER: string[] = [
  MATERIAL_CODES.CLEAR,
  MATERIAL_CODES.BARWASTE,
  MATERIAL_CODES.GREEN,
  MATERIAL_CODES.BARWASTE_WITH_RING,
  MATERIAL_CODES.OTHERS,
];

function computeShortage(input: ReportInput, weights: WeightResult, config: EngineConfig): ShortageResult {
  const { totalInvoiceWeight, totalDalmiaWeight } = weights;
  const shortfallTotal = totalInvoiceWeight - totalDalmiaWeight;
  const toleranceKg = (totalDalmiaWeight * n(input.weightTolerancePercent)) / 100;

  // Q43: IF(M18/M15 < 0.995, …) — rewritten without the division so a blank invoice cannot #DIV/0.
  const beyondTolerance = config.useWeightToleranceRow
    ? shortfallTotal > toleranceKg + WEIGHT_EPSILON_KG
    : totalInvoiceWeight > 0 &&
      totalDalmiaWeight < totalInvoiceWeight * (1 - config.toleranceFraction) - WEIGHT_EPSILON_KG;

  const clearRate = n(input.materials.find((m) => m.code === MATERIAL_CODES.CLEAR)?.dalmiaRate);
  const adjustmentFor = (code: string): number =>
    n(input.shortageAdjustments?.find((a) => a.materialCode === code)?.adjustmentQty);

  const ordered = [...input.materials].sort((a, b) => {
    const ia = SHORTAGE_ORDER.indexOf(a.code);
    const ib = SHORTAGE_ORDER.indexOf(b.code);
    return (ia === -1 ? SHORTAGE_ORDER.length : ia) - (ib === -1 ? SHORTAGE_ORDER.length : ib);
  });

  const lines = ordered.map((m): ShortageLineResult => {
    const invoice = n(m.invoiceWeightKg);
    const dalmia = n(m.dalmiaWeightKg);
    const shortageQty = invoice - dalmia;
    const rate = n(m.dalmiaRate);
    const adjustmentQty = adjustmentFor(m.code);
    const base = { materialCode: m.code, materialName: m.name, shortageQty, rate, adjustmentQty };
    const finish = (
      l: Omit<ShortageLineResult, keyof typeof base | 'differenceAmount'>,
    ): ShortageLineResult => ({ ...base, ...l, differenceAmount: l.approvedAmount - l.standardAmount });

    switch (m.code) {
      case MATERIAL_CODES.CLEAR: {
        // Charged on the TOTAL shortfall of the truck (not Clear alone), at the Clear rate.
        const chargeQty = beyondTolerance ? Math.max(shortfallTotal - adjustmentQty, 0) : 0;
        return finish({
          kind: 'WEIGHT_SHORT',
          amountRate: rate,
          standardAmount: beyondTolerance ? shortfallTotal * rate : 0,
          approvedQty: shortageQty,
          approvedChargeQty: chargeQty,
          approvedAmount: chargeQty * rate,
        });
      }
      case MATERIAL_CODES.BARWASTE: {
        // The kg are already charged at Clear rate in row 43; this row adds the price premium.
        const premium = rate - clearRate;
        const excess = dalmia > invoice;
        const approvedQty = excess ? 0 : shortageQty;
        const chargeQty = excess ? 0 : Math.max(approvedQty - adjustmentQty, 0);
        return finish({
          kind: 'PRICE_PREMIUM',
          amountRate: premium,
          standardAmount: excess ? 0 : shortageQty * premium,
          approvedQty,
          approvedChargeQty: chargeQty,
          approvedAmount: chargeQty * premium,
        });
      }
      case MATERIAL_CODES.GREEN: {
        // Charged on EXCESS green: qty is negative and (Green − Clear) is normally negative → positive recovery.
        const priceDiff = rate - clearRate;
        const short = dalmia < invoice;
        const approvedQty = dalmia > invoice ? shortageQty : 0;
        return finish({
          kind: 'EXCESS_GREEN',
          amountRate: priceDiff,
          standardAmount: short ? 0 : shortageQty * priceDiff,
          approvedQty,
          approvedChargeQty: short ? 0 : approvedQty,
          approvedAmount: short ? 0 : approvedQty * priceDiff,
        });
      }
      default: {
        const qty = config.allowNegativeOtherShortage ? shortageQty : Math.max(shortageQty, 0);
        return finish({
          kind: 'OTHER',
          amountRate: rate,
          standardAmount: qty * rate,
          approvedQty: qty,
          approvedChargeQty: qty,
          approvedAmount: qty * rate,
        });
      }
    }
  });

  return {
    shortfallTotal,
    toleranceKg,
    toleranceTest: config.useWeightToleranceRow ? 'TOLERANCE_ROW' : 'FRACTION',
    beyondTolerance,
    lines,
    subtotal: {
      standardAmount: sum(lines.map((l) => l.standardAmount)),
      approvedAmount: sum(lines.map((l) => l.approvedAmount)),
      differenceAmount: sum(lines.map((l) => l.differenceAmount)),
    },
  };
}

// ---------------------------------------------------------------- entry point

export function calculateReport(input: ReportInput): EngineOutput {
  const { config } = input;
  const weights = computeWeights(input.materials);
  const totalBaleWeight = sum(input.baleWeightsKg.map(n));

  const parameters = [...config.parameters]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => computeParameter(p, input, weights, totalBaleWeight));

  const discretionary = sumDeductions(parameters.filter((p) => p.category === 'DISCRETIONARY'));
  const nonDiscretionary = sumDeductions(parameters.filter((p) => p.category === 'NON_DISCRETIONARY'));
  const contamination = sumDeductions([discretionary, nonDiscretionary]);

  const shortage = computeShortage(input, weights, config);

  return {
    weights,
    totalBaleWeight,
    parameters,
    subtotals: { discretionary, nonDiscretionary, contamination },
    shortage,
    grandTotal: {
      standardAmount: contamination.standardAmount + shortage.subtotal.standardAmount,
      approvedAmount: contamination.approvedAmount + shortage.subtotal.approvedAmount,
      differenceAmount: contamination.differenceAmount + shortage.subtotal.differenceAmount,
    },
  };
}
