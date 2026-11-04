import { round } from './engine';
import type { EngineOutput, ShortageLineResult } from './types';

export interface NarrationOptions {
  grnNumber?: string | null;
  /** Decimal places for amounts (default 0 — whole rupees). */
  amountDp?: number;
  /** Decimal places for quantities and rates (default 2, trailing zeros trimmed). */
  qtyDp?: number;
}

const fmt = (value: number, dp: number): string => String(round(value, dp));

function shortageLabel(line: ShortageLineResult): string {
  switch (line.kind) {
    case 'WEIGHT_SHORT':
      return 'Weight Short';
    case 'EXCESS_GREEN':
      return 'Excess Green';
    case 'PRICE_PREMIUM':
      return `${line.materialName} Short`;
    default:
      return `${line.materialName} Short`;
  }
}

/**
 * Tally narration for an approved report, e.g.
 * "Being Debit Note for Moisture-27384 (228.2*120), Weight Short-10800 (90*120) and GRN No. 4521."
 * Only lines with a non-zero approved amount are listed.
 */
export function buildTallyNarration(output: EngineOutput, options: NarrationOptions = {}): string {
  const amountDp = options.amountDp ?? 0;
  const qtyDp = options.qtyDp ?? 2;
  const nonZero = (amount: number): boolean => round(amount, 2) !== 0;

  const parts: string[] = [];

  for (const p of output.parameters) {
    if (!nonZero(p.approvedAmount)) continue;
    parts.push(`${p.name}-${fmt(p.approvedAmount, amountDp)} (${fmt(p.approvedQty, qtyDp)}*${fmt(p.rate, qtyDp)})`);
  }

  for (const l of output.shortage.lines) {
    if (!nonZero(l.approvedAmount)) continue;
    // Excess green is (negative qty × negative price difference); narrate it as positives.
    const bothNegative = l.approvedChargeQty < 0 && l.amountRate < 0;
    const qty = bothNegative ? -l.approvedChargeQty : l.approvedChargeQty;
    const rate = bothNegative ? -l.amountRate : l.amountRate;
    parts.push(`${shortageLabel(l)}-${fmt(l.approvedAmount, amountDp)} (${fmt(qty, qtyDp)}*${fmt(rate, qtyDp)})`);
  }

  const grn = options.grnNumber?.trim();
  const grnText = grn ? `GRN No. ${grn}` : '';

  if (parts.length === 0) return grnText ? `Being Debit Note for ${grnText}.` : '';
  return `Being Debit Note for ${parts.join(', ')}${grnText ? ` and ${grnText}` : ''}.`;
}
