import { ION_CONFIG, type IonConfig } from './config';
import type { MoneyLike } from './money';
import { roundMoney } from './money';

export interface DeductionForReason {
  parameterCode: string;
  name: string;
  sortOrder: number;
  approvedAmount: MoneyLike;
}

const isNonZero = (v: MoneyLike): boolean => !roundMoney(v).isZero();

/** The non-zero deductions in report order, comma separated, before any cut. */
export function reasonList(
  input: { deductions: DeductionForReason[]; shortageAmounts: MoneyLike[] },
  config: IonConfig = ION_CONFIG,
): string {
  const names = [...input.deductions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((d) => isNonZero(d.approvedAmount))
    .map((d) => config.reasonLabels[d.parameterCode] ?? d.name);
  if (input.shortageAmounts.some(isNonZero)) names.push(config.reasonLabels.SHORTAGE ?? 'Shortage');
  return names.join(', ');
}

/**
 * Reason Details as our team writes it: the non-zero deductions in report order, comma separated, cut at 50 characters.
 * The QC number is appended only when the whole thing still fits.
 */
export function buildReasonDetails(
  input: { deductions: DeductionForReason[]; shortageAmounts: MoneyLike[]; qcNo: string },
  config: IonConfig = ION_CONFIG,
): string {
  const max = config.reasonDetailsMaxLength;
  const list = reasonList(input, config);
  if (!list) return '';
  const withQc = `${list}, ${input.qcNo}`;
  if (withQc.length <= max) return withQc;
  // A hard cut at the limit, without leaving a dangling separator.
  return list.slice(0, max).replace(/[,\s]+$/, '');
}

/** The GRN as iON wants it: trimmed, upper case, no spaces (so " dpnl/grn_rm/2627/4331 " matches). */
export function normalizeGrn(grn: string): string {
  return grn.replace(/\s+/g, '').toUpperCase();
}

/** Plain text, one line, ASCII only ("Rs", never the rupee sign), as iON's Remarks field wants it. */
export function toPlainLine(text: string): string {
  return text
    .replace(/₹/g, 'Rs')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The narration and the item Remarks. Always carries the QC number, so every iON debit note traces back to its QC. */
export function buildNarration(input: { qcNo: string; invoiceNo: string; grnNo: string; truckNo?: string | null }): string {
  const parts = [`QC deduction as per ${input.qcNo}`, `Inv ${input.invoiceNo}`, `GRN ${input.grnNo}`];
  if (input.truckNo?.trim()) parts.push(`Truck ${input.truckNo.trim()}`);
  return toPlainLine(parts.join(', '));
}

export interface MaterialForItem {
  code: string;
  name: string;
  ionItemCode: string | null;
  invoiceWeightKg: MoneyLike | null;
}

/** The main item takes the whole debit: Clear when the invoice has any, otherwise the material with the highest invoice weight. */
export function pickMainMaterial<T extends MaterialForItem>(lines: T[]): T | null {
  const weight = (l: T): number => Number(l.invoiceWeightKg ?? 0);
  const onInvoice = lines.filter((l) => weight(l) > 0);
  const clear = onInvoice.find((l) => l.code === 'CLEAR');
  if (clear) return clear;
  return onInvoice.reduce<T | null>((best, l) => (best === null || weight(l) > weight(best) ? l : best), null);
}
