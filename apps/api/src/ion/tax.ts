import { Prisma } from '@prisma/client';
import { ION_CONFIG, type IonConfig, type IonTaxCode } from './config';
import { roundMoney, type MoneyLike } from './money';

export interface ExpectedTax {
  code: string;
  /** 2-decimal rupees, e.g. "180.00". */
  amount: string;
}

/** The tax codes iON should show for this debit note: IGST for another state, CGST + SGST for the plant's own. */
export function taxCodesFor(interState: boolean, config: IonConfig = ION_CONFIG): IonTaxCode[] {
  return interState ? config.interStateTaxes : config.intraStateTaxes;
}

/** Each line is rounded to the paisa on its own, the way iON rounds each tax line. */
export function expectedTaxes(amount: MoneyLike, interState: boolean, config: IonConfig = ION_CONFIG): ExpectedTax[] {
  const base = new Prisma.Decimal(amount.toString());
  return taxCodesFor(interState, config).map((t) => ({
    code: t.code,
    amount: roundMoney(base.times(t.ratePercent).div(100)).toFixed(2),
  }));
}

export interface ActualTax {
  code: string;
  amount: string | number;
}

/** Compares iON's calculated tax lines with ours. Any problem means the worker stops. */
export function compareTaxes(
  expected: ExpectedTax[],
  actual: ActualTax[],
  toleranceRupees: number = ION_CONFIG.taxToleranceRupees,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const tol = new Prisma.Decimal(toleranceRupees);
  const remaining = [...actual];
  for (const e of expected) {
    const at = remaining.findIndex((a) => a.code.trim() === e.code);
    if (at < 0) {
      problems.push(`iON has no tax line "${e.code}" (expected ${e.amount})`);
      continue;
    }
    const [a] = remaining.splice(at, 1);
    const diff = new Prisma.Decimal(String(a!.amount).replace(/,/g, '')).minus(e.amount).abs();
    if (diff.greaterThan(tol)) problems.push(`"${e.code}": iON shows ${a!.amount}, expected ${e.amount} (more than ${toleranceRupees} apart)`);
  }
  for (const extra of remaining) problems.push(`iON has an unexpected tax line "${extra.code}" (${extra.amount})`);
  return { ok: problems.length === 0, problems };
}
