const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct4 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const clean = (v: number): number => (Object.is(v, -0) || Math.abs(v) < 0.005 ? 0 : v);

/** ₹ 33,545.40 — Indian digit grouping, 2 dp. */
export const formatINR = (v: number | null | undefined): string => (v == null ? '' : `₹ ${inr.format(clean(v))}`);
/** Amount without the ₹ sign, for dense table columns whose header already says ₹. */
export const formatAmount = (v: number | null | undefined): string => (v == null ? '' : inr.format(clean(v)));
export const formatQty = (v: number | null | undefined): string => (v == null ? '' : qty.format(clean(v)));
export const formatPercent = (v: number | null | undefined): string => (v == null ? '' : pct4.format(v));

/** 'YYYY-MM-DD' or ISO timestamp → dd-MM-yyyy (Asia/Kolkata for timestamps). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}-${m}-${y}`;
  }
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(value))
    .replace(/\//g, '-');
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(value),
  );
  return `${formatDate(value)} ${time}`;
}

/** Today's date in Asia/Kolkata as 'YYYY-MM-DD'. */
export const todayIST = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
