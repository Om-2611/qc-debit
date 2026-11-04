import { z } from 'zod';

// ---------------------------------------------------------------- Excel import (admin only)

export const IMPORT_ACTIONS = ['import', 'skip', 'overwrite'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

/** The sheet's approved Total (A+B+C) may differ from the engine's by this much (₹) before it is flagged. */
export const IMPORT_MISMATCH_TOLERANCE = 1;
/** "Undo this import" is offered for this long after the upload. */
export const IMPORT_UNDO_WINDOW_HOURS = 24;
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const importCommitSchema = z.object({
  previewId: z.string().uuid(),
  /** Used as the report date of every sheet that has none of its own. */
  fallbackReportDate: isoDate.nullable().optional(),
  sheets: z
    .array(
      z.object({
        sheetName: z.string().min(1).max(200),
        action: z.enum(IMPORT_ACTIONS),
        /** Existing supplier to file the report under; null/omitted = match by name, else create one. */
        supplierId: z.string().min(1).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type ImportCommitInput = z.input<typeof importCommitSchema>;

// ---------------------------------------------------------------- mismatch detail (stored on the report)

export interface MismatchRow {
  kind: 'PARAMETER' | 'SHORTAGE' | 'TOTAL';
  /** Parameter or material code; 'TOTAL' for the Total (A+B+C) row. */
  code: string;
  name: string;
  sheetStandardAmount: number;
  sheetApprovedAmount: number;
  engineStandardAmount: number;
  engineApprovedAmount: number;
}

// ---------------------------------------------------------------- preview

export interface ImportTotals {
  standardAmount: number;
  approvedAmount: number;
}

export interface ImportDuplicateDto {
  reportId: string;
  reportNo: string;
  status: string;
  /** Which rule matched: same GRN, or same truck + invoice number. */
  matchedOn: 'GRN' | 'TRUCK_INVOICE';
}

export interface ImportSheetPreview {
  sheetName: string;
  /** false = "not a QC sheet"; such sheets are listed and ignored. */
  isTemplate: boolean;
  truckNumber: string | null;
  grnNumber: string | null;
  invoiceNumber: string | null;
  /** null = the sheet has no date; a fallback date is needed at commit. */
  reportDate: string | null;
  partyName: string | null;
  /** Existing supplier matched by name or code (case-insensitive); null = one will be created. */
  supplierMatch: { id: string; name: string } | null;
  /** The sheet's own Total (A+B+C): Q49 standard, S49 approved. */
  sheetTotals: ImportTotals | null;
  /** The engine's totals on the sheet's inputs; null when it could not be run (no date, errors). */
  engineTotals: ImportTotals | null;
  /** Approved totals differ by more than IMPORT_MISMATCH_TOLERANCE. */
  hasMismatch: boolean;
  warnings: string[];
  errors: string[];
  duplicates: ImportDuplicateDto[];
  /** Default choice: 'skip' for duplicates, sheets with errors and non-template sheets. */
  action: ImportAction;
}

export interface ImportPreviewDto {
  previewId: string;
  fileName: string;
  sheets: ImportSheetPreview[];
}

// ---------------------------------------------------------------- commit result

export type ImportOutcome = 'imported' | 'skipped' | 'failed';

export interface ImportSheetResult {
  sheetName: string;
  outcome: ImportOutcome;
  /** Why it was skipped or failed. */
  reason: string | null;
  reportId: string | null;
  reportNo: string | null;
  hasMismatch: boolean;
  /** Report numbers deleted by "overwrite". */
  overwritten: string[];
}

export interface ImportCommitResult {
  batchId: string;
  fileName: string;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  results: ImportSheetResult[];
}

// ---------------------------------------------------------------- batches

export interface ImportBatchDto {
  id: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: { id: string; name: string };
  sheetCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  /** Reports of this batch that still exist. */
  reportCount: number;
  undoneAt: string | null;
  canUndo: boolean;
  /** ISO time after which the batch can no longer be undone. */
  undoUntil: string;
  results: ImportSheetResult[];
}
