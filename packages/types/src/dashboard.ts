import { z } from 'zod';
import { REPORT_STATUSES } from './roles';
import type { ReportSource, ReportStatus } from './roles';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

/** Filters shared by every dashboard endpoint; `from`/`to` are inclusive and apply to the report date. */
export const dashboardQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    supplierId: z.string().min(1).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, '"from" must not be after "to"');
export type DashboardQuery = z.input<typeof dashboardQuerySchema>;

/** The Excel view lists every status, so it alone takes a status filter. */
export const excelViewQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    supplierId: z.string().min(1).optional(),
    status: z.enum(REPORT_STATUSES).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, '"from" must not be after "to"');
export type ExcelViewQuery = z.input<typeof excelViewQuerySchema>;

/** Money figures count APPROVED reports only. */
export interface DashboardSummaryDto {
  /** Reports of any status dated within the range. */
  reportsInRange: number;
  approvedReports: number;
  standardTotal: number;
  approvedTotal: number;
  /** standard − approved. */
  waivedTotal: number;
  /** Not date-filtered: the manager's queue as it stands now. */
  pendingApprovals: number;
  /** Reports dated in the current calendar month (Asia/Kolkata); not date-filtered. */
  reportsThisMonth: number;
}

export interface DashboardSupplierRow {
  /** null = reports whose party was typed freely and is not in the supplier master. */
  supplierId: string | null;
  supplierName: string;
  reportCount: number;
  standardTotal: number;
  approvedTotal: number;
}

export const WEIGHT_SHORTAGE_KEY = 'WEIGHT_SHORTAGE';

export interface DashboardParameterRow {
  /** Parameter code, or WEIGHT_SHORTAGE for block C. */
  key: string;
  name: string;
  category: 'DISCRETIONARY' | 'NON_DISCRETIONARY' | 'SHORTAGE';
  standardAmount: number;
  approvedAmount: number;
}

export interface DashboardMonthRow {
  /** YYYY-MM */
  month: string;
  reportCount: number;
  standardTotal: number;
  approvedTotal: number;
  /** Mean of Moisture actual % over the month's reports that have a reading; null when none has. */
  averageMoisturePercent: number | null;
}

/** One row per report: the sheet's key outputs. */
export interface ExcelViewRow {
  id: string;
  reportNo: string;
  reportDate: string;
  supplierName: string | null;
  truckNumber: string | null;
  grnNumber: string | null;
  invoiceNumber: string | null;
  status: ReportStatus;
  source: ReportSource;
  totalInvoiceWeightKg: number;
  totalDalmiaWeightKg: number;
  /** invoice − Dalmia; negative = excess received. */
  shortfallKg: number;
  moistureActualPercent: number | null;
  discretionaryApproved: number;
  nonDiscretionaryApproved: number;
  shortageApproved: number;
  standardTotal: number;
  approvedTotal: number;
  waived: number;
}

export interface ExcelViewResponse {
  rows: ExcelViewRow[];
  /** Matching reports; more than rows.length when the list was cut at the row limit. */
  total: number;
}
