import { Prisma } from '@prisma/client';

export type MoneyLike = Prisma.Decimal | number | string;

/** Half-up to 2 decimals on the decimal value itself, never through a float. */
export function roundMoney(value: MoneyLike): Prisma.Decimal {
  return new Prisma.Decimal(value.toString()).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** "dd/mm/yyyy" from an ISO "yyyy-mm-dd". */
export function isoToIon(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** The current date in India as "yyyy-mm-dd": the iON voucher date and the "invoice not in the future" check use it. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
