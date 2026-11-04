import { z } from 'zod';
import type { EngineConfig, EngineOutput } from '@dalmia/calc';
import { REPORT_SOURCES, REPORT_STATUSES } from './roles';
import type { ReportSource, ReportStatus } from './roles';

// ---------------------------------------------------------------- field helpers

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();
const qty = z.number().finite().min(0, 'Cannot be negative').max(10_000_000).nullable();
const percent = z.number().finite().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100').nullable();
/** Sent back by the client so a save cannot silently overwrite someone else's newer save. */
const updatedAt = z.string().datetime().optional();

// ---------------------------------------------------------------- request bodies

const headerFields = {
  reportDate: isoDate,
  supplierId: z.string().min(1).nullable(),
  partyNameRaw: text(200),
  poNumber: text(60),
  truckNumber: text(30),
  tokenDate: isoDate.nullable(),
  tokenNumber: text(60),
  invoiceNumber: text(60),
  invoiceDate: isoDate.nullable(),
};

export const createReportSchema = z.object(headerFields).partial().required({ reportDate: true });
export type CreateReportInput = z.input<typeof createReportSchema>;

export const headerPatchSchema = z.object(headerFields).partial().extend({ updatedAt });
export type HeaderPatch = z.input<typeof headerPatchSchema>;

export const weightsPatchSchema = z.object({
  materials: z
    .array(
      z.object({
        code: z.string().min(1),
        invoiceWeightKg: qty.optional(),
        invoiceBales: qty.optional(),
        invoiceRate: qty.optional(),
        dalmiaWeightKg: qty.optional(),
        dalmiaBales: qty.optional(),
        dalmiaRate: qty.optional(),
      }),
    )
    .max(20),
  updatedAt,
});
export type WeightsPatch = z.input<typeof weightsPatchSchema>;

export const BALE_COUNT = 3;

export const qcPatchSchema = z.object({
  baleWeightsKg: z.array(qty).max(BALE_COUNT).optional(),
  readings: z
    .array(
      z.object({
        parameterCode: z.string().min(1),
        perBale: z.array(qty).max(BALE_COUNT).optional(),
        /** Sheet column M "No. of Bales": how many bales of the truck show this defect. */
        affectedBales: qty.optional(),
      }),
    )
    .max(50)
    .optional(),
  updatedAt,
});
export type QcPatch = z.input<typeof qcPatchSchema>;

/** Stores: the GRN raised once QC is done (sheet I13). */
export const grnPatchSchema = z.object({ grnNumber: text(60), updatedAt });
export type GrnPatch = z.input<typeof grnPatchSchema>;

export const approvalPatchSchema = z.object({
  adjustments: z
    .array(z.object({ parameterCode: z.string().min(1), purchaseAdjustment: percent }))
    .max(50)
    .optional(),
  shortageAdjustments: z
    .array(z.object({ materialCode: z.string().min(1), adjustmentQty: qty }))
    .max(20)
    .optional(),
  otherDescriptions: z
    .array(z.object({ materialCode: z.string().min(1), description: text(200) }))
    .max(20)
    .optional(),
  weightTolerancePercent: percent.optional(),
  remarks: text(2000).optional(),
  updatedAt,
});
export type ApprovalPatch = z.input<typeof approvalPatchSchema>;

export const sendBackSchema = z.object({ note: z.string().trim().min(3, 'Tell the analyst what to fix').max(1000) });
export const reopenSchema = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(1000) });

export const reportListQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  source: z.enum(REPORT_SOURCES).optional(),
  supplierId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type ReportListQuery = z.input<typeof reportListQuerySchema>;

// ---------------------------------------------------------------- responses

export interface UserRef {
  id: string;
  name: string;
}

export interface ReportListItem {
  id: string;
  reportNo: string;
  status: ReportStatus;
  source: ReportSource;
  reportDate: string;
  supplierId: string | null;
  supplierName: string | null;
  truckNumber: string | null;
  grnNumber: string | null;
  invoiceNumber: string | null;
  standardTotal: number;
  approvedTotal: number;
  hasMismatch: boolean;
  sentBack: boolean;
  updatedAt: string;
  /** true = the totals were zeroed because this user may not see rates. */
  ratesHidden?: boolean;
}

export interface ReportListResponse {
  items: ReportListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ReportMaterialDto {
  code: string;
  name: string;
  invoiceWeightKg: number | null;
  invoiceBales: number | null;
  invoiceRate: number | null;
  dalmiaWeightKg: number | null;
  dalmiaBales: number | null;
  dalmiaRate: number | null;
}

export interface ReportReadingDto {
  parameterCode: string;
  perBale: (number | null)[];
  purchaseAdjustment: number | null;
  affectedBales: number | null;
}

export interface ReportDto {
  id: string;
  reportNo: string;
  status: ReportStatus;
  source: ReportSource;
  reportDate: string;
  supplierId: string | null;
  supplierName: string | null;
  partyNameRaw: string | null;
  poNumber: string | null;
  truckNumber: string | null;
  grnNumber: string | null;
  tokenDate: string | null;
  tokenNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  weightTolerancePercent: number | null;
  remarks: string | null;
  sentBackNote: string | null;
  reopenReason: string | null;
  createdBy: UserRef;
  checkedBy: UserRef | null;
  approvedBy: UserRef | null;
  checkedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  narration: string | null;
  /** true = rates and every rupee figure were zeroed for this user; the UI hides those columns. */
  ratesHidden?: boolean;
  hasMismatch: boolean;
  /** Imported reports only: where the engine's figures differ from the sheet's own (which are the ones kept). */
  mismatchDetail: import('./import').MismatchRow[] | null;
  /** Engine's approved Total (A+B+C) on an imported sheet's inputs; null for reports made in the app. */
  recomputedTotal: number | null;

  materials: ReportMaterialDto[];
  baleWeightsKg: (number | null)[];
  readings: ReportReadingDto[];
  shortageAdjustments: { materialCode: string; adjustmentQty: number | null }[];
  otherDescriptions: { materialCode: string; description: string | null }[];

  /**
   * Live engine output for reports in progress. For APPROVED reports the amounts are the frozen
   * snapshot taken at approval (or the sheet's own figures for imports), not a fresh calculation.
   */
  output: EngineOutput;
  outputIsSnapshot: boolean;
}

export interface SupplierDto {
  id: string;
  name: string;
  code: string;
}

export interface LookupsDto {
  suppliers: SupplierDto[];
  materials: { code: string; name: string; sortOrder: number }[];
  engineConfig: EngineConfig;
  defaultWeightTolerancePercent: number | null;
}

export interface AuditEntryDto {
  id: string;
  at: string;
  user: UserRef;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
}
