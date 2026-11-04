import type { EngineConfig, NormRule, ParameterConfig, RateRule } from './types';
import { MATERIAL_CODES, PARAMETER_CODES } from './types';

const allYear = (normPercent: number): NormRule[] => [
  { seasonStartMonth: 1, seasonEndMonth: 12, normPercent },
];

/** Monsoon (1 Jul – 30 Sep) vs. rest of year (1 Oct – 30 Jun). */
const seasonal = (monsoonPercent: number, otherPercent: number): NormRule[] => [
  { seasonStartMonth: 7, seasonEndMonth: 9, normPercent: monsoonPercent },
  { seasonStartMonth: 10, seasonEndMonth: 6, normPercent: otherPercent },
];

const rate = (r: Omit<RateRule, 'effectiveFrom'>): RateRule[] => [r];

/**
 * Defaults reproduce the client's "Debit Note Format 1.xlsx" formula for formula (Non Food Grade-PET and Metal
 * have no formulas in the sheet, so they are recorded but not deducted). Every value here is seeded into the database and is
 * editable under Admin → Settings; see README "Business rules & known Excel discrepancies".
 */
export const DEFAULT_PARAMETERS: ParameterConfig[] = [
  // A) Discretionary — sheet rows 26–30
  {
    code: PARAMETER_CODES.MOISTURE,
    name: 'Moisture',
    category: 'DISCRETIONARY',
    inputMode: 'PERCENT_PER_BALE',
    sortOrder: 10,
    isDeductible: true,
    norms: seasonal(5, 3),
    rates: rate({ rateMode: 'DOMINANT_MATERIAL_RATE', weightBase: 'TOTAL_DALMIA_WEIGHT' }),
  },
  {
    code: PARAMETER_CODES.DIRTY_BOTTLE,
    name: 'Dirty bottle',
    category: 'DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 20,
    isDeductible: true,
    // Sheet says 3% outside the monsoon; the PDD said 4%. Client to confirm.
    norms: seasonal(4, 3),
    // Sheet row 28: excess % × bales affected × average truck bale weight × 10, charged only below 6%.
    rates: rate({ rateMode: 'FIXED', fixedRate: 10, weightBase: 'AFFECTED_BALES_TRUCK_AVG', maxActualPercent: 6 }),
  },
  {
    code: PARAMETER_CODES.JAR_PET,
    name: 'Jar-PET',
    category: 'DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 30,
    isDeductible: true,
    norms: allYear(2),
    // Sheet row 30: excess % × bales affected × average sample bale weight × 5.
    rates: rate({ rateMode: 'FIXED', fixedRate: 5, weightBase: 'AFFECTED_BALES_SAMPLE_AVG' }),
  },
  // B) Non-discretionary — sheet rows 33–39
  {
    code: PARAMETER_CODES.NON_FOOD_GRADE_PET,
    name: 'Non Food Grade-PET',
    category: 'NON_DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 40,
    isDeductible: false,
    norms: allYear(2),
    rates: rate({ rateMode: 'DOMINANT_MATERIAL_RATE', weightBase: 'TOTAL_DALMIA_WEIGHT' }),
  },
  {
    code: PARAMETER_CODES.IRON_PATTI,
    name: 'Iron/Patti',
    category: 'NON_DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 50,
    isDeductible: true,
    norms: allYear(0.5),
    rates: rate({ rateMode: 'DOMINANT_MATERIAL_RATE', weightBase: 'TOTAL_DALMIA_WEIGHT' }),
  },
  {
    code: PARAMETER_CODES.RAFFIA,
    name: 'Raffia',
    category: 'NON_DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 60,
    isDeductible: true,
    norms: allYear(0),
    rates: rate({ rateMode: 'DOMINANT_MATERIAL_RATE', weightBase: 'TOTAL_DALMIA_WEIGHT' }),
  },
  {
    code: PARAMETER_CODES.COLOUR_BOTTLE_PET,
    name: 'Colour Bottle-PET',
    category: 'NON_DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 70,
    isDeductible: true,
    norms: allYear(0.5),
    rates: rate({ rateMode: 'CLEAR_RATE_MINUS_20', weightBase: 'CLEAR_WEIGHT' }),
  },
  {
    code: PARAMETER_CODES.NON_PET,
    name: 'Non-Pet',
    category: 'NON_DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 80,
    isDeductible: true,
    norms: allYear(0.5),
    rates: rate({ rateMode: 'CLEAR_RATE_MINUS_20', weightBase: 'CLEAR_WEIGHT' }),
  },
  {
    code: PARAMETER_CODES.ALUMINIUM_PET,
    name: 'Aluminium-PET',
    category: 'NON_DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 90,
    isDeductible: true,
    norms: allYear(1),
    rates: rate({ rateMode: 'FIXED', fixedRate: 10, weightBase: 'CLEAR_WEIGHT' }),
  },
  {
    code: PARAMETER_CODES.METAL,
    name: 'Metal',
    category: 'NON_DISCRETIONARY',
    inputMode: 'KG_PER_BALE',
    sortOrder: 100,
    isDeductible: false,
    norms: allYear(0),
    rates: rate({ rateMode: 'DOMINANT_MATERIAL_RATE', weightBase: 'TOTAL_DALMIA_WEIGHT' }),
  },
];

export const DEFAULT_MATERIALS: { code: string; name: string; sortOrder: number }[] = [
  { code: MATERIAL_CODES.CLEAR, name: 'Clear', sortOrder: 10 },
  { code: MATERIAL_CODES.GREEN, name: 'Green', sortOrder: 20 },
  { code: MATERIAL_CODES.BARWASTE, name: 'Barwaste', sortOrder: 30 },
  { code: MATERIAL_CODES.BARWASTE_WITH_RING, name: 'Barwaste With Ring', sortOrder: 40 },
  { code: MATERIAL_CODES.OTHERS, name: 'Others', sortOrder: 50 },
];

export const DEFAULT_TOLERANCE_FRACTION = 0.005;

export function defaultEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    parameters: DEFAULT_PARAMETERS.map((p) => ({
      ...p,
      norms: p.norms.map((n) => ({ ...n })),
      rates: p.rates.map((r) => ({ ...r })),
    })),
    toleranceFraction: DEFAULT_TOLERANCE_FRACTION,
    useWeightToleranceRow: false,
    allowNegativeOtherShortage: false,
    ...overrides,
  };
}
