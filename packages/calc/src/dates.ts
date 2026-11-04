import type { DateLike } from './types';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface YMD {
  year: number;
  month: number; // 1–12
  day: number;
}

/**
 * Calendar date of a report in Asia/Kolkata. Strings starting 'YYYY-MM-DD' are taken literally
 * (no timezone maths); Date objects are shifted to IST so a report saved at 00:10 IST on 1 July
 * is a July report even though it is still 30 June in UTC.
 */
export function toYMD(value: DateLike): YMD {
  if (typeof value === 'string') {
    const text = value.trim();
    const m = ISO_DATE.exec(text);
    if (m && text.length === 10) {
      return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    }
    return toYMD(new Date(text));
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid report date: ${String(value)}`);
  }
  const ist = new Date(value.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

/** Sortable integer yyyymmdd. */
export function ymdKey(value: DateLike): number {
  const { year, month, day } = toYMD(value);
  return year * 10000 + month * 100 + day;
}

export function monthInSeason(month: number, startMonth: number, endMonth: number): boolean {
  return startMonth <= endMonth
    ? month >= startMonth && month <= endMonth
    : month >= startMonth || month <= endMonth;
}

export function seasonLength(startMonth: number, endMonth: number): number {
  return startMonth <= endMonth ? endMonth - startMonth + 1 : 12 - startMonth + 1 + endMonth;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function seasonLabel(startMonth: number, endMonth: number): string {
  if (seasonLength(startMonth, endMonth) >= 12) return '';
  return `${MONTHS[startMonth - 1]}–${MONTHS[endMonth - 1]}`;
}
