import type { AuthUser, ReportDto, ReportListItem } from '@dalmia/types';

/**
 * A user without rate access must not learn a rate from anything they receive — and an amount
 * divided by a quantity is a rate, so every rupee figure goes too. Weights, readings, percentages
 * and quantities stay, so the Gate, Store and Analyst can still do their work.
 */
export const canSeeRates = (user: AuthUser): boolean => user.role === 'ADMIN' || user.canSeeRates;

export function redactReport(dto: ReportDto, user: AuthUser): ReportDto {
  if (canSeeRates(user)) return dto;
  const out = dto.output;
  const zeroMoney = { standardAmount: 0, approvedAmount: 0, differenceAmount: 0 };
  return {
    ...dto,
    ratesHidden: true,
    narration: null,
    materials: dto.materials.map((m) => ({ ...m, invoiceRate: null, dalmiaRate: null })),
    output: {
      ...out,
      weights: { ...out.weights, dominantRate: 0, clearRate: 0 },
      parameters: out.parameters.map((p) => ({ ...p, rate: 0, ...zeroMoney })),
      subtotals: {
        discretionary: { ...out.subtotals.discretionary, ...zeroMoney },
        nonDiscretionary: { ...out.subtotals.nonDiscretionary, ...zeroMoney },
        contamination: { ...out.subtotals.contamination, ...zeroMoney },
      },
      shortage: {
        ...out.shortage,
        lines: out.shortage.lines.map((l) => ({ ...l, rate: 0, amountRate: 0, ...zeroMoney })),
        subtotal: { ...zeroMoney },
      },
      grandTotal: { ...zeroMoney },
    },
  };
}

export function redactListItem(item: ReportListItem, user: AuthUser): ReportListItem {
  return canSeeRates(user) ? item : { ...item, standardTotal: 0, approvedTotal: 0, ratesHidden: true };
}

/** Audit rows that would reveal a rate or an amount. */
const RATE_FIELD = /Rate$|^narration$/;
export const auditRevealsRate = (field: string | null): boolean => field !== null && RATE_FIELD.test(field);
