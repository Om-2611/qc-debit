/** Stable material codes. Column order in the Excel sheet: E, G, I, K, L. */
export const MATERIAL_CODES = {
  CLEAR: 'CLEAR',
  GREEN: 'GREEN',
  BARWASTE: 'BARWASTE',
  BARWASTE_WITH_RING: 'BARWASTE_WITH_RING',
  OTHERS: 'OTHERS',
} as const;
export type MaterialCode = (typeof MATERIAL_CODES)[keyof typeof MATERIAL_CODES];

export const PARAMETER_CODES = {
  MOISTURE: 'MOISTURE',
  DIRTY_BOTTLE: 'DIRTY_BOTTLE',
  JAR_PET: 'JAR_PET',
  NON_FOOD_GRADE_PET: 'NON_FOOD_GRADE_PET',
  IRON_PATTI: 'IRON_PATTI',
  RAFFIA: 'RAFFIA',
  COLOUR_BOTTLE_PET: 'COLOUR_BOTTLE_PET',
  NON_PET: 'NON_PET',
  ALUMINIUM_PET: 'ALUMINIUM_PET',
  METAL: 'METAL',
} as const;

export type ParameterCategory = 'DISCRETIONARY' | 'NON_DISCRETIONARY';
export type InputMode = 'KG_PER_BALE' | 'PERCENT_PER_BALE';
export type RateMode =
  | 'DOMINANT_MATERIAL_RATE'
  | 'DOMINANT_MATERIAL_RATE_MINUS_20'
  /** Sheet O36/O37: =$E$20-20. */
  | 'CLEAR_RATE_MINUS_20'
  | 'FIXED';

/**
 * What the excess % is applied to.
 * - TOTAL_DALMIA_WEIGHT (M18) and CLEAR_WEIGHT (E18): a share of the truck.
 * - AFFECTED_BALES_TRUCK_AVG: "No. of Bales" (column M) × average bale weight of the truck (M18 ÷ M19) — sheet row 28.
 * - AFFECTED_BALES_SAMPLE_AVG: "No. of Bales" × average weight of the sampled bales (AVERAGE(E24:J24)) — sheet row 30.
 */
export type WeightBase =
  | 'TOTAL_DALMIA_WEIGHT'
  | 'CLEAR_WEIGHT'
  | 'AFFECTED_BALES_TRUCK_AVG'
  | 'AFFECTED_BALES_SAMPLE_AVG';

export const usesAffectedBales = (base: WeightBase): boolean =>
  base === 'AFFECTED_BALES_TRUCK_AVG' || base === 'AFFECTED_BALES_SAMPLE_AVG';

/** 'YYYY-MM-DD' (preferred, timezone-proof) or a Date (interpreted in Asia/Kolkata). */
export type DateLike = string | Date;

export interface NormRule {
  /** 1–12. A season may wrap the year end, e.g. start 10, end 6 = Oct–Jun. 1–12 = all year. */
  seasonStartMonth: number;
  seasonEndMonth: number;
  normPercent: number;
  /** Rule applies to reports dated on/after this. Omit = always. */
  effectiveFrom?: DateLike | null;
}

export interface RateRule {
  rateMode: RateMode;
  /** Required when rateMode = FIXED. */
  fixedRate?: number | null;
  weightBase: WeightBase;
  /** Sheet Q28: the amount is charged only while actual % is below this (Dirty bottle: 6). Null = no cut-off. */
  maxActualPercent?: number | null;
  effectiveFrom?: DateLike | null;
}

export interface ParameterConfig {
  code: string;
  name: string;
  category: ParameterCategory;
  inputMode: InputMode;
  sortOrder: number;
  /** false = show the reading and actual % but never raise a deduction (matches rows with no formula in the old sheet). */
  isDeductible: boolean;
  norms: NormRule[];
  rates: RateRule[];
}

export interface EngineConfig {
  parameters: ParameterConfig[];
  /** Excel hard-codes 0.995 in Q43, i.e. a 0.005 tolerance. */
  toleranceFraction: number;
  /** When true the shortage test becomes `shortfallTotal > toleranceKg` (row 50) instead of the fraction test. */
  useWeightToleranceRow: boolean;
  /**
   * Rows 46/47 (Barwaste With Ring, Others) have no rule in the sheet. When false (default) an
   * excess of these materials yields 0 rather than a negative (credit) line.
   */
  allowNegativeOtherShortage: boolean;
}

export interface MaterialInput {
  code: string;
  name: string;
  invoiceWeightKg: number | null;
  invoiceBales: number | null;
  invoiceRate: number | null;
  dalmiaWeightKg: number | null;
  dalmiaBales: number | null;
  dalmiaRate: number | null;
}

export interface ReadingInput {
  parameterCode: string;
  /** kg or % per bale depending on the parameter's inputMode. null/undefined = blank. */
  perBale: (number | null | undefined)[];
  /**
   * "Purchase allowed" (column N): the total % purchase accepts, e.g. 7 when the norm is 5. The approved
   * amount is (purchase allowed − norm)% × total Dalmia weight (M18) × rate, with purchase allowed capped between
   * the norm and the actual %. Blank, 0 or a value at or below the norm gives an approved amount of 0.
   */
  purchaseAdjustment?: number | null;
  /** "No. of Bales" affected (column M). Only used by parameters whose weight base is per affected bale. */
  affectedBales?: number | null;
}

export interface ShortageAdjustmentInput {
  materialCode: string;
  adjustmentQty: number;
}

export interface ReportInput {
  reportDate: DateLike;
  materials: MaterialInput[];
  /** Up to 3 sample bales; blanks ignored. */
  baleWeightsKg: (number | null | undefined)[];
  readings: ReadingInput[];
  shortageAdjustments?: ShortageAdjustmentInput[];
  /** Row 50, D50 — percent of total Dalmia weight. Informational unless config.useWeightToleranceRow. */
  weightTolerancePercent?: number | null;
  config: EngineConfig;
}

// ---------------------------------------------------------------- outputs

export interface WeightResult {
  totalInvoiceWeight: number;
  totalDalmiaWeight: number;
  totalInvoiceBales: number;
  totalDalmiaBales: number;
  /** dalmia − invoice per material (row 21). Negative = short. */
  differences: { materialCode: string; materialName: string; differenceKg: number }[];
  totalDifference: number;
  dominantMaterialCode: string | null;
  dominantRate: number;
  clearWeight: number;
  clearRate: number;
  /** M18 ÷ M19; 0 when no bale count has been entered. */
  averageTruckBaleWeight: number;
}

export interface DeductionAmounts {
  standardQty: number;
  standardAmount: number;
  approvedQty: number;
  approvedAmount: number;
  differenceQty: number;
  differenceAmount: number;
}

export interface ParameterResult extends DeductionAmounts {
  parameterCode: string;
  name: string;
  category: ParameterCategory;
  inputMode: InputMode;
  sortOrder: number;
  isDeductible: boolean;
  normPercent: number;
  /** The active season of the chosen norm rule, e.g. "Jul–Sep", "Oct–Jun" or "" for all-year. */
  normSeasonLabel: string;
  /** Per-bale % (kg ÷ bale weight × 100 for KG parameters; the reading itself for % parameters). null = blank. */
  balePercents: (number | null)[];
  /** Σ kg over bales; null for PERCENT_PER_BALE parameters. */
  totalKg: number | null;
  actualPercent: number;
  overNorm: boolean;
  /** "Purchase allowed" as entered (0 = blank). */
  purchaseAdjustment: number;
  /** The threshold the approved deduction was measured from: max(purchase allowed, norm). */
  approvedFromPercent: number;
  rate: number;
  weightBase: WeightBase;
  weightBaseKg: number;
  affectedBales: number | null;
  /** true when actual % reached the rule's cut-off, so no amount is charged (sheet Q28). */
  beyondCutOff: boolean;
}

export type ShortageKind = 'WEIGHT_SHORT' | 'PRICE_PREMIUM' | 'EXCESS_GREEN' | 'OTHER';

export interface ShortageLineResult {
  materialCode: string;
  materialName: string;
  kind: ShortageKind;
  /** −difference = invoice − dalmia (column O). Negative = excess received. */
  shortageQty: number;
  /** Material's Dalmia rate (column P). */
  rate: number;
  /** Rate actually multiplied into the amounts (Clear rate, or the price difference vs Clear). */
  amountRate: number;
  standardAmount: number;
  approvedQty: number;
  /** Quantity actually multiplied into approvedAmount (after adjustment). */
  approvedChargeQty: number;
  approvedAmount: number;
  differenceAmount: number;
  adjustmentQty: number;
}

export interface ShortageResult {
  /** totalInvoiceWeight − totalDalmiaWeight. */
  shortfallTotal: number;
  /** K50 = totalDalmiaWeight × weightTolerancePercent%. */
  toleranceKg: number;
  /** Which test decided the Clear row. */
  toleranceTest: 'FRACTION' | 'TOLERANCE_ROW';
  /** true = shortfall is beyond tolerance, so the Clear (weight short) row is charged. */
  beyondTolerance: boolean;
  lines: ShortageLineResult[];
  subtotal: { standardAmount: number; approvedAmount: number; differenceAmount: number };
}

export interface EngineOutput {
  weights: WeightResult;
  totalBaleWeight: number;
  parameters: ParameterResult[];
  subtotals: {
    discretionary: DeductionAmounts;
    nonDiscretionary: DeductionAmounts;
    /** Total (A+B), row 41. */
    contamination: DeductionAmounts;
  };
  shortage: ShortageResult;
  /** Total (A+B+C), row 49 — amounts only; quantities are deliberately not summed across blocks. */
  grandTotal: { standardAmount: number; approvedAmount: number; differenceAmount: number };
}
