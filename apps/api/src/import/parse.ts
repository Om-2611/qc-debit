import ExcelJS from 'exceljs';
import { MATERIAL_CODES as M, PARAMETER_CODES as P } from '@dalmia/calc';
import { BALE_COUNT } from '@dalmia/types';
import { KG_COLUMNS, MATERIAL_COLUMN, PARAMETER_ROW, PERCENT_COLUMNS, SHORTAGE_ROW } from '../export/excel';

/**
 * Reads one worksheet of the client's workbook ("Debit Note Format", form DPIPL/QA/F-11) into plain
 * values. Fields are located by their LABEL first and by the fixed cell of the real workbook second,
 * so a sheet with a row inserted or removed still imports. Everything is read by CACHED value: the
 * importer never evaluates a formula, and a formula without a cached result counts as blank.
 */

// ---------------------------------------------------------------- parsed shape (stored as JSON in the preview file)

export interface ParsedParameterRow {
  row: number;
  /** Jul–Sep row or rest-of-year row of a seasonal parameter; 'ALL' for the others. */
  season: 'MONSOON' | 'OTHER' | 'ALL';
  perBale: (number | null)[];
  normPercent: number | null;
  totalKg: number | null;
  actualPercent: number | null;
  affectedBales: number | null;
  purchaseAdjustment: number | null;
  rate: number | null;
  standardQty: number | null;
  standardAmount: number | null;
  approvedQty: number | null;
  approvedAmount: number | null;
  differenceQty: number | null;
  differenceAmount: number | null;
}

export interface ParsedMaterial {
  code: string;
  invoiceWeightKg: number | null;
  invoiceBales: number | null;
  invoiceRate: number | null;
  dalmiaWeightKg: number | null;
  dalmiaBales: number | null;
  dalmiaRate: number | null;
}

export interface ParsedShortageRow {
  materialCode: string;
  row: number;
  shortageQty: number | null;
  rate: number | null;
  standardAmount: number | null;
  approvedQty: number | null;
  approvedAmount: number | null;
  adjustment: number | null;
}

export interface ParsedSheet {
  sheetName: string;
  /** false = "not a QC sheet": nothing else is filled in. */
  isTemplate: boolean;
  header: {
    reportDate: string | null;
    partyName: string | null;
    poNumber: string | null;
    truckNumber: string | null;
    grnNumber: string | null;
    tokenDate: string | null;
    tokenNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
  };
  materials: ParsedMaterial[];
  baleWeightsKg: (number | null)[];
  /** One entry per parameter code; seasonal parameters carry both of their rows. */
  parameters: Record<string, ParsedParameterRow[]>;
  shortage: ParsedShortageRow[];
  otherDescription: string | null;
  weightTolerancePercent: number | null;
  remarks: string | null;
  checkedByName: string | null;
  approvedByName: string | null;
  /** The sheet's own Total (A+B+C): Q49 / S49. null = the file carries no calculated value there. */
  totals: { standardAmount: number | null; approvedAmount: number | null };
  warnings: string[];
}

// ---------------------------------------------------------------- cell reading

const colNo = (letter: string): number => letter.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

/** Cached value of a cell. Slaves of a merged range report their master's (shifted) content, so they read as blank. */
function cellValue(ws: ExcelJS.Worksheet, row: number, col: number): string | number | Date | null {
  if (row < 1 || col < 1) return null;
  const cell = ws.getCell(row, col);
  if (cell.isMerged && cell.master.address !== cell.address) return null;
  return unwrap(cell.value);
}

function unwrap(v: ExcelJS.CellValue | undefined): string | number | Date | null {
  if (v == null || typeof v === 'boolean') return null;
  if (typeof v === 'string' || typeof v === 'number' || v instanceof Date) return v;
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('result' in v) return unwrap(v.result as ExcelJS.CellValue); // typed inputs can be formulas too (H26 is "=5.38")
  if ('formula' in v || 'sharedFormula' in v) return null; // never calculated: blank
  if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
  return null; // { error }
}

const numberAt = (ws: ExcelJS.Worksheet, row: number, col: number): number | null => {
  const v = cellValue(ws, row, col);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
};

const textAt = (ws: ExcelJS.Worksheet, row: number, col: number, max = 200): string | null => {
  const v = cellValue(ws, row, col);
  if (v == null) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
  return s === '' ? null : s.slice(0, max);
};

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const pad2 = (n: number) => String(n).padStart(2, '0');

function ymd(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  const real = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return real && year >= 1990 && year <= 2100 ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

/** A JS Date (exceljs gives UTC midnight), an Excel serial number, or text such as 26-08-2026. */
export function toIsoDate(v: string | number | Date | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    if (!(v > 20000 && v < 80000)) return null; // 1954 … 2119
    const d = new Date(EXCEL_EPOCH_MS + Math.floor(v) * 86_400_000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = v.trim();
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s); // Indian order: day first
  if (dmy) return ymd(dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

// ---------------------------------------------------------------- label index

/** "Moisture - during July to Sept" → "moistureduringjulytosept": case, spacing and punctuation never matter. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

interface Label {
  row: number;
  col: number;
  /** Last column of the label's merged range; the value sits to the right of this. */
  endCol: number;
  key: string;
  raw: string;
}

const SCAN_ROWS = 150;
const SCAN_COLS = 40;

function indexLabels(ws: ExcelJS.Worksheet): Label[] {
  const mergeEnd = new Map<string, number>();
  for (const range of (ws.model as unknown as { merges?: string[] }).merges ?? []) {
    const m = /^([A-Z]+)\d+:([A-Z]+)\d+$/.exec(range);
    if (m) mergeEnd.set(range.split(':')[0]!, colNo(m[2]!));
  }
  const labels: Label[] = [];
  ws.eachRow((row, r) => {
    if (r > SCAN_ROWS) return;
    row.eachCell((cell, c) => {
      if (c > SCAN_COLS || (cell.isMerged && cell.master.address !== cell.address)) return;
      const v = unwrap(cell.value);
      if (typeof v !== 'string') return;
      const key = norm(v);
      if (key) labels.push({ row: r, col: c, endCol: mergeEnd.get(cell.address) ?? c, key, raw: v.trim() });
    });
  });
  return labels;
}

type Matcher = string[] | ((key: string) => boolean);
const matches = (m: Matcher, key: string): boolean => (Array.isArray(m) ? m.includes(key) : m(key));

// ---------------------------------------------------------------- what to look for

const HEADER_FIELDS = {
  reportDate: { labels: ['date', 'reportdate'], cell: 'L10' },
  partyName: { labels: ['partyname', 'party', 'suppliername'], cell: 'B11' },
  poNumber: { labels: ['pono', 'ponumber'], cell: 'B12' },
  truckNumber: { labels: ['truckno', 'trucknumber', 'vehicleno', 'vehiclenumber'], cell: 'B13' },
  tokenDate: { labels: ['tokendt', 'tokendate'], cell: 'I11' },
  tokenNumber: { labels: ['tokenno', 'tokennumber'], cell: 'I12' },
  grnNumber: { labels: ['grnno', 'grnnumber', 'grn'], cell: 'I13' },
  invoiceNumber: { labels: ['invoiceno', 'invoicenumber'], cell: 'L12' },
  invoiceDate: { labels: ['invoicedt', 'invoicedate'], cell: 'L13' },
  remarks: { labels: ['remarks', 'remark'], cell: 'B51' },
  checkedByName: { labels: ['checkedby'], cell: 'B54' },
  approvedByName: { labels: ['approvedby'], cell: 'L54' },
} as const;

const MATERIAL_HEADERS: Record<string, string[]> = {
  [M.CLEAR]: ['clear'],
  [M.GREEN]: ['green'],
  [M.BARWASTE]: ['barwaste'],
  [M.BARWASTE_WITH_RING]: ['barwastewithring'],
  [M.OTHERS]: ['others', 'other'],
};

const seasonal = (stem: string) => ({
  monsoon: (k: string) => k.startsWith(stem) && k.includes('jul'),
  other: (k: string) => k === stem,
});
const PARAMETER_LABELS: Record<string, { monsoon: Matcher; other?: Matcher }> = {
  [P.MOISTURE]: seasonal('moisture'),
  [P.DIRTY_BOTTLE]: seasonal('dirtybottle'),
  [P.JAR_PET]: { monsoon: ['jarpet', 'jar'] },
  [P.NON_FOOD_GRADE_PET]: { monsoon: ['nonfoodgradepet', 'nonfoodgrade'] },
  [P.IRON_PATTI]: { monsoon: ['ironpatti'] },
  [P.RAFFIA]: { monsoon: ['raffia'] },
  [P.COLOUR_BOTTLE_PET]: { monsoon: ['colourbottlepet', 'colorbottlepet', 'colourbottle'] },
  [P.NON_PET]: { monsoon: ['nonpet'] },
  [P.ALUMINIUM_PET]: { monsoon: ['aluminiumpet', 'aluminumpet', 'aluminium'] },
  [P.METAL]: { monsoon: ['metal'] },
};
/** Moisture is typed as a % (columns F/H/J); every other parameter as kg (E/G/I). */
const PERCENT_TYPED = new Set<string>([P.MOISTURE]);

const SHORTAGE_LABELS: Record<string, Matcher> = {
  [M.CLEAR]: ['clearshortageexcess', 'clearshortage'],
  [M.BARWASTE]: ['barwasteshortageexcess', 'barwasteshortage'],
  [M.GREEN]: ['greenshortageexcess', 'greenshortage'],
  [M.BARWASTE_WITH_RING]: ['barwastewithringshortageexcess', 'barwastewithringshortage'],
  [M.OTHERS]: (k) => k.startsWith('otherpleasespecify'),
};

// ---------------------------------------------------------------- the parser

/** "QC Report" in rows 1–12 and "QC Parameters" in column A. */
function looksLikeTemplate(labels: Label[]): boolean {
  return labels.some((l) => l.row <= 12 && l.key.includes('qcreport')) && labels.some((l) => l.col === 1 && l.key === 'qcparameters');
}

export function parseSheet(ws: ExcelJS.Worksheet): ParsedSheet {
  const labels = indexLabels(ws);
  const sheet: ParsedSheet = {
    sheetName: ws.name,
    isTemplate: looksLikeTemplate(labels),
    header: { reportDate: null, partyName: null, poNumber: null, truckNumber: null, grnNumber: null, tokenDate: null, tokenNumber: null, invoiceNumber: null, invoiceDate: null },
    materials: [],
    baleWeightsKg: [],
    parameters: {},
    shortage: [],
    otherDescription: null,
    weightTolerancePercent: null,
    remarks: null,
    checkedByName: null,
    approvedByName: null,
    totals: { standardAmount: null, approvedAmount: null },
    warnings: [],
  };
  if (!sheet.isTemplate) return sheet;
  const warn = (message: string) => sheet.warnings.push(message);
  const find = (m: Matcher, where: (l: Label) => boolean = () => true): Label | undefined => labels.find((l) => where(l) && matches(m, l.key));

  // ---- header block, remarks and sign-off: the value is the cell to the right of its label
  const valueCell = (field: keyof typeof HEADER_FIELDS): { row: number; col: number } => {
    const spec = HEADER_FIELDS[field];
    const fixed = /^([A-Z]+)(\d+)$/.exec(spec.cell)!;
    const fixedCol = colNo(fixed[1]!);
    const label = find([...spec.labels]);
    if (!label) return { row: Number(fixed[2]), col: fixedCol };
    const adjacent = { row: label.row, col: label.endCol + 1 };
    // "Approved by" is in J54 but the name is typed in L54: try the sheet's own column when the neighbour is blank.
    if (cellValue(ws, adjacent.row, adjacent.col) == null && fixedCol > adjacent.col) return { row: label.row, col: fixedCol };
    return adjacent;
  };
  const headerText = (field: keyof typeof HEADER_FIELDS, max?: number) => {
    const at = valueCell(field);
    return textAt(ws, at.row, at.col, max);
  };
  const headerDate = (field: keyof typeof HEADER_FIELDS, name: string) => {
    const at = valueCell(field);
    const v = cellValue(ws, at.row, at.col);
    const iso = toIsoDate(v);
    if (v != null && !iso) warn(`${name}: "${String(v)}" is not a date this importer understands; it was left blank.`);
    return iso;
  };
  sheet.header = {
    reportDate: headerDate('reportDate', 'Date'),
    partyName: headerText('partyName'),
    poNumber: headerText('poNumber', 60),
    truckNumber: headerText('truckNumber', 30),
    grnNumber: headerText('grnNumber', 60),
    tokenDate: headerDate('tokenDate', 'Token Dt.'),
    tokenNumber: headerText('tokenNumber', 60),
    invoiceNumber: headerText('invoiceNumber', 60),
    invoiceDate: headerDate('invoiceDate', 'Invoice Dt.'),
  };
  sheet.remarks = headerText('remarks', 2000);
  sheet.checkedByName = headerText('checkedByName');
  sheet.approvedByName = headerText('approvedByName');

  // ---- weights: material columns from the header row ("Clear … Others"), rows from the two block labels
  const tableTop = find(['qcparameters'], (l) => l.col === 1)!.row;
  const clearHeader = find(MATERIAL_HEADERS[M.CLEAR]!, (l) => l.row < tableTop);
  const invoiceRow = find(['aspersupplierinvoice'])?.row ?? 15;
  const dalmiaRow = find(['asperdalmia'])?.row ?? 18;
  for (const [code, names] of Object.entries(MATERIAL_HEADERS)) {
    const header = clearHeader && find(names, (l) => l.row === clearHeader.row);
    if (clearHeader && !header) warn(`Column heading for ${code} was not found; column ${MATERIAL_COLUMN[code]} was used.`);
    const col = header?.col ?? colNo(MATERIAL_COLUMN[code]!);
    sheet.materials.push({
      code,
      invoiceWeightKg: numberAt(ws, invoiceRow, col),
      invoiceBales: numberAt(ws, invoiceRow + 1, col),
      invoiceRate: numberAt(ws, invoiceRow + 2, col),
      dalmiaWeightKg: numberAt(ws, dalmiaRow, col),
      dalmiaBales: numberAt(ws, dalmiaRow + 1, col),
      dalmiaRate: numberAt(ws, dalmiaRow + 2, col),
    });
  }

  // ---- QC table columns, from its two heading rows. "No of Bales" also labels rows 16/19, hence the row filter.
  const inHeading = (l: Label) => l.row >= tableTop && l.row <= tableTop + 1;
  const headingCol = (keys: string[], fallback: string): number => find(keys, inHeading)?.col ?? colNo(fallback);
  const kgCols = KG_COLUMNS.map((c, i) => headingCol([`bale${i + 1}`], c));
  // The % of a bale is the second half of its merged "Bale n" heading (E/F, G/H, I/J).
  const pctCols = kgCols.map((c, i) => c + (colNo(PERCENT_COLUMNS[i]!) - colNo(KG_COLUMNS[i]!)));
  const averageCol = headingCol(['average'], 'K');
  const col = {
    norm: labels.filter((l) => inHeading(l) && ['norms', 'norm'].includes(l.key)).pop()?.col ?? colNo('D'),
    totalKg: averageCol,
    actual: averageCol + 1,
    affectedBales: headingCol(['noofbales'], 'M'),
    adjustment: headingCol(['purchaseadjustment'], 'N'),
    rate: headingCol(['deductionrate'], 'O'),
    standardQty: headingCol(['standardqty'], 'P'),
    standardAmount: headingCol(['standardamount'], 'Q'),
    approvedQty: headingCol(['approvedqty'], 'R'),
    approvedAmount: headingCol(['approvedamount'], 'S'),
    differenceQty: headingCol(['differenceqty'], 'T'),
    differenceAmount: headingCol(['differenceamount'], 'U'),
  };

  const belowHeading = (l: Label) => l.row > tableTop + 1;
  const baleRow = find(['balewt', 'baleweight', 'balewtkg'], (l) => l.row > tableTop)?.row ?? 24;
  sheet.baleWeightsKg = kgCols.slice(0, BALE_COUNT).map((c) => numberAt(ws, baleRow, c));

  // ---- parameter rows. Labels first; the fixed row only when its label is missing and nothing else claimed that row.
  const wanted: { code: string; season: ParsedParameterRow['season']; matcher: Matcher; fixedRow: number }[] = [];
  for (const [code, l] of Object.entries(PARAMETER_LABELS)) {
    const rows = PARAMETER_ROW[code]!;
    wanted.push({ code, season: l.other ? 'MONSOON' : 'ALL', matcher: l.monsoon, fixedRow: rows.monsoon });
    if (l.other) wanted.push({ code, season: 'OTHER', matcher: l.other, fixedRow: rows.other });
  }
  const located = wanted.map((w) => ({ ...w, row: find(w.matcher, belowHeading)?.row }));
  const claimed = new Set(located.map((w) => w.row).filter((r): r is number => r != null));
  for (const w of located) {
    let row = w.row;
    if (row == null && !claimed.has(w.fixedRow)) {
      row = w.fixedRow;
      claimed.add(row);
      warn(`Row label for ${w.code}${w.season === 'ALL' ? '' : w.season === 'MONSOON' ? ' (Jul–Sep)' : ' (rest of year)'} was not found; row ${row} was used.`);
    }
    if (row == null) {
      warn(`Row for ${w.code} was not found; it was imported as blank.`);
      continue;
    }
    const n = (c: number) => numberAt(ws, row, c);
    // Column N: older sheets typed a concession in points above the norm (0.45), newer ones the total % purchase
    // allows (7). A value below the norm can only be the old convention, so it is converted.
    const purchaseAllowed = (n: number | null, norm: number | null): number | null =>
      n != null && n > 0 && norm != null && n < norm ? Math.round((norm + n) * 10000) / 10000 : n;
    (sheet.parameters[w.code] ??= []).push({
      row,
      season: w.season,
      perBale: (PERCENT_TYPED.has(w.code) ? pctCols : kgCols).slice(0, BALE_COUNT).map(n),
      normPercent: n(col.norm),
      totalKg: PERCENT_TYPED.has(w.code) ? null : n(col.totalKg),
      actualPercent: n(col.actual),
      affectedBales: n(col.affectedBales),
      purchaseAdjustment: purchaseAllowed(n(col.adjustment), n(col.norm)),
      rate: n(col.rate),
      standardQty: n(col.standardQty),
      standardAmount: n(col.standardAmount),
      approvedQty: n(col.approvedQty),
      approvedAmount: n(col.approvedAmount),
      differenceQty: n(col.differenceQty),
      differenceAmount: n(col.differenceAmount),
    });
  }

  // ---- shortage block: Qty sits under "Deduction Rate" (O), Rate under "Standard Qty" (P), then Q, R, S
  for (const [code, matcher] of Object.entries(SHORTAGE_LABELS)) {
    const label = find(matcher, belowHeading);
    const row = label?.row ?? SHORTAGE_ROW[code]!;
    sheet.shortage.push({
      materialCode: code,
      row,
      shortageQty: numberAt(ws, row, col.rate),
      rate: numberAt(ws, row, col.standardQty),
      standardAmount: numberAt(ws, row, col.standardAmount),
      approvedQty: numberAt(ws, row, col.approvedQty),
      approvedAmount: numberAt(ws, row, col.approvedAmount),
      adjustment: numberAt(ws, row, col.adjustment),
    });
    if (code === M.OTHERS) {
      const raw = label?.raw ?? textAt(ws, row, 1) ?? '';
      const described = /other\s*\(\s*please\s+specify\s*\)\s*[:\-–]*\s*(.*)$/i.exec(raw);
      sheet.otherDescription = described?.[1]?.trim().slice(0, 200) || null;
    }
  }

  // ---- Total (A+B+C) and the footer
  const totalRow = find(['totalabc'], belowHeading)?.row ?? 49;
  sheet.totals = { standardAmount: numberAt(ws, totalRow, col.standardAmount), approvedAmount: numberAt(ws, totalRow, col.approvedAmount) };
  const toleranceRow = find(['weighttolerance'], belowHeading)?.row ?? 50;
  sheet.weightTolerancePercent = numberAt(ws, toleranceRow, col.norm);

  return sheet;
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb.worksheets.map(parseSheet);
}
