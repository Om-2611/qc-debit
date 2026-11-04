import { z } from 'zod';
import type { InputMode, ParameterCategory, RateMode, WeightBase } from '@dalmia/calc';

// ---------------------------------------------------------------- field helpers

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();
const nothingToUpdate = (v: object): boolean => Object.keys(v).length > 0;

// ---------------------------------------------------------------- suppliers

const supplierFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  code: z.string().trim().toUpperCase().min(1, 'Code is required').max(30),
  gstin: optionalText(20),
  address: optionalText(500),
  isActive: z.boolean(),
  ionSupplierCode: optionalText(50),
  ionAddressCode: optionalText(50),
  ionStateCode: z
    .string()
    .trim()
    .regex(/^\d{2}$/, 'Use the 2-digit GST state code, e.g. 27')
    .or(z.literal('').transform(() => null))
    .nullable(),
  gstRegistered: z.boolean(),
};

export const createSupplierSchema = z
  .object(supplierFields)
  .partial({ gstin: true, address: true, isActive: true, ionSupplierCode: true, ionAddressCode: true, ionStateCode: true, gstRegistered: true })
  .strict();
export type CreateSupplierInput = z.input<typeof createSupplierSchema>;

export const updateSupplierSchema = z.object(supplierFields).partial().strict().refine(nothingToUpdate, 'Nothing to update');
export type UpdateSupplierInput = z.input<typeof updateSupplierSchema>;

export interface AdminSupplierDto {
  id: string;
  name: string;
  code: string;
  gstin: string | null;
  address: string | null;
  isActive: boolean;
  ionSupplierCode: string | null;
  ionAddressCode: string | null;
  ionStateCode: string | null;
  gstRegistered: boolean;
  createdAt: string;
  /** Reports that reference the supplier — the reason suppliers are deactivated rather than deleted. */
  reportCount: number;
}

// ---------------------------------------------------------------- materials

/** `code` is the engine's key and is deliberately absent: strict() turns an attempt to change it into a 400. */
export const updateMaterialSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
    ionItemCode: optionalText(50),
  })
  .partial()
  .strict()
  .refine(nothingToUpdate, 'Nothing to update');
export type UpdateMaterialInput = z.input<typeof updateMaterialSchema>;

export interface AdminMaterialDto {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  ionItemCode: string | null;
}

// ---------------------------------------------------------------- plants

const gstStateCode = z.string().trim().regex(/^\d{2}$/, 'Use the 2-digit GST state code, e.g. 27');
const plantFields = {
  code: z.string().trim().toUpperCase().min(1, 'Code is required').max(20),
  name: z.string().trim().min(1, 'Name is required').max(200),
  ionSiteCode: z.string().trim().min(1, 'iON site code is required').max(30),
  ionSiteAddressLabel: z.string().trim().min(1, 'Site address label is required').max(100),
  stateCode: gstStateCode,
  isActive: z.boolean(),
};
export const createPlantSchema = z.object(plantFields).partial({ isActive: true }).strict();
export type CreatePlantInput = z.input<typeof createPlantSchema>;
export const updatePlantSchema = z.object(plantFields).partial().strict().refine(nothingToUpdate, 'Nothing to update');
export type UpdatePlantInput = z.input<typeof updatePlantSchema>;

export interface AdminPlantDto {
  id: string;
  code: string;
  name: string;
  ionSiteCode: string;
  ionSiteAddressLabel: string;
  stateCode: string;
  isActive: boolean;
  reportCount: number;
}

// ---------------------------------------------------------------- parameters, norms, rates

export const RATE_MODES = ['DOMINANT_MATERIAL_RATE', 'DOMINANT_MATERIAL_RATE_MINUS_20', 'CLEAR_RATE_MINUS_20', 'FIXED'] as const satisfies readonly RateMode[];
export const WEIGHT_BASES = ['TOTAL_DALMIA_WEIGHT', 'CLEAR_WEIGHT', 'AFFECTED_BALES_TRUCK_AVG', 'AFFECTED_BALES_SAMPLE_AVG'] as const satisfies readonly WeightBase[];

export const updateParameterSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
    isDeductible: z.boolean(),
  })
  .partial()
  .strict()
  .refine(nothingToUpdate, 'Nothing to update');
export type UpdateParameterInput = z.input<typeof updateParameterSchema>;

const month = z.number().int().min(1, 'Month must be 1–12').max(12, 'Month must be 1–12');

export const normRuleSchema = z
  .object({
    seasonStartMonth: month,
    seasonEndMonth: month,
    normPercent: z.number().finite().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100'),
    effectiveFrom: isoDate,
  })
  .strict();
export type NormRuleInput = z.infer<typeof normRuleSchema>;

export const replaceNormsSchema = z.object({ norms: z.array(normRuleSchema).min(1, 'At least one norm is required').max(48) }).strict();
export type ReplaceNormsInput = z.infer<typeof replaceNormsSchema>;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthsOf = (start: number, end: number): number[] => {
  const months: number[] = [];
  // Bounded, so a half-typed value in the dialog cannot loop forever.
  for (let m = start, i = 0; i < 12; m = (m % 12) + 1, i++) {
    months.push(m);
    if (m === end) break;
  }
  return months;
};

/**
 * The norms sharing one effective date must cover every month exactly once, otherwise a report dated in the
 * gap has no norm (treated as 0%) or the engine has to guess between two. Returns one message per problem;
 * shared so the dialog can show the same message before the API does.
 */
export function validateNormCoverage(norms: Pick<NormRuleInput, 'seasonStartMonth' | 'seasonEndMonth' | 'effectiveFrom'>[]): string[] {
  const problems: string[] = [];
  const byDate = new Map<string, number[]>();
  for (const n of norms) {
    const cover = byDate.get(n.effectiveFrom) ?? new Array<number>(13).fill(0);
    for (const m of monthsOf(n.seasonStartMonth, n.seasonEndMonth)) cover[m]! += 1;
    byDate.set(n.effectiveFrom, cover);
  }
  for (const [date, cover] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const names = (test: (count: number) => boolean) => MONTH_NAMES.filter((_n, i) => test(cover[i + 1]!)).join(', ');
    const missing = names((c) => c === 0);
    const twice = names((c) => c > 1);
    if (missing) problems.push(`Norms effective ${date} leave these months uncovered: ${missing}.`);
    if (twice) problems.push(`Norms effective ${date} cover these months more than once: ${twice}.`);
  }
  return problems;
}

export const rateRuleSchema = z
  .object({
    rateMode: z.enum(RATE_MODES),
    fixedRate: z.number().finite().min(0, 'Cannot be negative').max(1_000_000).nullable().optional(),
    weightBase: z.enum(WEIGHT_BASES),
    maxActualPercent: z.number().finite().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100').nullable().optional(),
    effectiveFrom: isoDate,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.rateMode === 'FIXED' && v.fixedRate == null) {
      ctx.addIssue({ code: 'custom', path: ['fixedRate'], message: 'A fixed rate is required when the rate mode is FIXED' });
    }
    if (v.rateMode !== 'FIXED' && v.fixedRate != null) {
      ctx.addIssue({ code: 'custom', path: ['fixedRate'], message: 'A fixed rate is only allowed when the rate mode is FIXED' });
    }
  });
export type RateRuleInput = z.infer<typeof rateRuleSchema>;

export interface NormRuleDto {
  id: string;
  seasonStartMonth: number;
  seasonEndMonth: number;
  normPercent: number;
  effectiveFrom: string;
}

export interface RateRuleDto {
  id: string;
  rateMode: RateMode;
  fixedRate: number | null;
  weightBase: WeightBase;
  maxActualPercent: number | null;
  effectiveFrom: string;
}

export interface AdminParameterDto {
  id: string;
  code: string;
  name: string;
  category: ParameterCategory;
  inputMode: InputMode;
  sortOrder: number;
  isActive: boolean;
  isDeductible: boolean;
  /** Every stored rule, newest effective date first; the engine picks by report date. */
  norms: NormRuleDto[];
  rates: RateRuleDto[];
}

// ---------------------------------------------------------------- global settings

/** strict(): an unknown key is a 400, not silently ignored. */
export const updateSettingsSchema = z
  .object({
    /** Fraction, not percent: 0.005 = the sheet's 0.5%. */
    toleranceFraction: z.number().finite().min(0, 'Cannot be negative').max(0.2, 'Cannot exceed 0.2 (20%)'),
    useWeightToleranceRow: z.boolean(),
    allowNegativeOtherShortage: z.boolean(),
    /** null = leave the report's Weight Tolerance row blank by default. */
    defaultWeightTolerancePercent: z.number().finite().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100').nullable(),
  })
  .partial()
  .strict()
  .refine(nothingToUpdate, 'Nothing to update');
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export interface SettingsDto {
  toleranceFraction: number;
  useWeightToleranceRow: boolean;
  allowNegativeOtherShortage: boolean;
  defaultWeightTolerancePercent: number | null;
}
