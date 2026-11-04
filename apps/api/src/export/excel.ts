import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { MATERIAL_CODES as M, PARAMETER_CODES as P, monthInSeason, toYMD, type ParameterResult } from '@dalmia/calc';
import type { ReportDto } from '@dalmia/types';

/**
 * Writes a report into the client's own workbook ("Debit Note Format 1.xlsx", sheet "Format") so it
 * can still be opened, checked and printed in Excel. The sheet's formulas are kept and recalculate
 * when the file is opened; the cached results are also set to the app's figures so previews and
 * tools that do not recalculate (including this app's importer) read the right numbers.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Works both from src/export (tsx, tests) and from the bundled dist/server.js.
const TEMPLATE_CANDIDATES = [
  path.resolve(HERE, '../../assets/debit-note-template.xlsx'),
  path.resolve(HERE, '../assets/debit-note-template.xlsx'),
];

export const SHEET_NAME = 'Format';
export const MATERIAL_COLUMN: Record<string, string> = {
  [M.CLEAR]: 'E',
  [M.GREEN]: 'G',
  [M.BARWASTE]: 'I',
  [M.BARWASTE_WITH_RING]: 'K',
  [M.OTHERS]: 'L',
};
export const KG_COLUMNS = ['E', 'G', 'I'];
export const PERCENT_COLUMNS = ['F', 'H', 'J'];
/** Jul–Sep row / rest-of-year row for the two seasonal parameters; one row for the others. */
export const PARAMETER_ROW: Record<string, { monsoon: number; other: number }> = {
  [P.MOISTURE]: { monsoon: 26, other: 27 },
  [P.DIRTY_BOTTLE]: { monsoon: 28, other: 29 },
  [P.JAR_PET]: { monsoon: 30, other: 30 },
  [P.NON_FOOD_GRADE_PET]: { monsoon: 33, other: 33 },
  [P.IRON_PATTI]: { monsoon: 34, other: 34 },
  [P.RAFFIA]: { monsoon: 35, other: 35 },
  [P.COLOUR_BOTTLE_PET]: { monsoon: 36, other: 36 },
  [P.NON_PET]: { monsoon: 37, other: 37 },
  [P.ALUMINIUM_PET]: { monsoon: 38, other: 38 },
  [P.METAL]: { monsoon: 39, other: 39 },
};
export const SHORTAGE_ROW: Record<string, number> = {
  [M.CLEAR]: 43,
  [M.BARWASTE]: 44,
  [M.GREEN]: 45,
  [M.BARWASTE_WITH_RING]: 46,
  [M.OTHERS]: 47,
};

export const isMonsoon = (reportDate: string): boolean => monthInSeason(toYMD(reportDate).month, 7, 9);
export const parameterRow = (code: string, reportDate: string): number | undefined => {
  const rows = PARAMETER_ROW[code];
  return rows ? (isMonsoon(reportDate) ? rows.monsoon : rows.other) : undefined;
};

const toDate = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

type Results = Map<string, number>;

/**
 * Column N is "purchase allowed" (the total % accepted), capped between D and L; approved = (N − D)% × M18 —
 * not the template's (L−N−D)%, which treated N as a concession in points.
 */
const approvedQtyFormula = (r: number): string => `MAX(MIN(N${r},MAX(L${r},D${r}))-D${r},0)%*$M$18`;

/** Formulas the sheet lacks (rest-of-year rows 27 and 29) or hard-codes (row 28's "4"), written per row. */
function moistureFormulas(r: number): Record<string, string> {
  return {
    [`L${r}`]: `IFERROR((AVERAGE(E${r}:J${r})),0)`,
    [`O${r}`]: 'INDEX($E$18:$L$20,3,MATCH(MAX($E$18:$L$18),E18:L18,0))',
    [`P${r}`]: `IF(L${r}>D${r},((L${r}-D${r})%*$M$18),0)`,
    [`Q${r}`]: `IF(L${r}>D${r},((L${r}-D${r})%*$M$18*$O$${r}),)`,
    [`R${r}`]: approvedQtyFormula(r),
    [`S${r}`]: `${approvedQtyFormula(r)}*$O$${r}`,
    [`T${r}`]: `R${r}-P${r}`,
    [`U${r}`]: `S${r}-Q${r}`,
  };
}

function dirtyBottleFormulas(r: number, cutOff: number | null): Record<string, string> {
  const amount = `(L${r}-D${r})%*$O$${r}*M${r}*($M$18/$M$19)`;
  return {
    [`F${r}`]: `IFERROR((E${r}/$E$24*100),0)`,
    [`H${r}`]: `IFERROR((G${r}/$G$24*100),0)`,
    [`J${r}`]: `IFERROR((I${r}/$I$24*100),0)`,
    [`K${r}`]: `E${r}+G${r}+I${r}`,
    [`L${r}`]: `IFERROR((K${r}/$K$24*100),0)`,
    // The sheet tests against a typed 4; the norm cell is used here so a changed norm still works.
    [`P${r}`]: `IFERROR(IF(L${r}>D${r},(L${r}-D${r})%*$M$${r}*($M$18/$M$19),0),0)`,
    [`Q${r}`]:
      cutOff == null
        ? `IFERROR(IF(L${r}>D${r},${amount},0),0)`
        : `IFERROR(IF(L${r}>D${r},IF(L${r}<${cutOff},${amount},0),0),0)`,
    [`T${r}`]: `R${r}-P${r}`,
    [`U${r}`]: `S${r}-Q${r}`,
  };
}

export async function loadTemplate(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  let lastError: unknown;
  for (const file of TEMPLATE_CANDIDATES) {
    try {
      await wb.xlsx.readFile(file);
      return wb;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Excel template not found (looked in ${TEMPLATE_CANDIDATES.join(', ')}): ${String(lastError)}`);
}

/** Every typed (non-formula) input cell of the template, which carries the client's sample data. */
function inputCells(): string[] {
  const cells = ['L10', 'B11', 'B12', 'B13', 'I11', 'I12', 'I13', 'L12', 'L13', 'E24', 'G24', 'I24', 'D50', 'B51', 'B54', 'L54', 'N43', 'N44', 'N45'];
  for (const col of Object.values(MATERIAL_COLUMN)) for (let r = 15; r <= 20; r++) cells.push(`${col}${r}`);
  for (const { monsoon, other } of Object.values(PARAMETER_ROW)) {
    for (const r of new Set([monsoon, other])) {
      cells.push(`M${r}`, `N${r}`);
      for (const c of [...KG_COLUMNS, ...PERCENT_COLUMNS]) cells.push(`${c}${r}`);
    }
  }
  return cells;
}

function isFormula(v: ExcelJS.CellValue): v is ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue {
  return typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v);
}

/**
 * Replaces every formula cell's cached result with the app's figure (or nothing), and turns shared
 * formulas into plain ones. Without this the file would carry the template's sample results until
 * someone opens it in Excel.
 */
function refreshCachedResults(ws: ExcelJS.Worksheet, results: Results): void {
  const formulas: { address: string; formula: string }[] = [];
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      // The second half of a merged pair (F21 of E21:F21) reports its master's formula shifted by a column;
      // writing that back would overwrite the master, so only masters are touched.
      if (cell.isMerged && cell.master.address !== cell.address) return;
      if (isFormula(cell.value)) formulas.push({ address: cell.address, formula: cell.formula });
    }),
  );
  for (const { address, formula } of formulas) {
    const result = results.get(address);
    ws.getCell(address).value = result === undefined ? { formula } : { formula, result };
  }
}

export async function buildReportWorkbook(report: ReportDto): Promise<ExcelJS.Workbook> {
  const wb = await loadTemplate();
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Template has no "${SHEET_NAME}" sheet`);
  const out = report.output;
  const results: Results = new Map();
  const set = (address: string, value: ExcelJS.CellValue) => {
    ws.getCell(address).value = value;
  };

  // Typed cells that hold formulas in the template (H26 is "=5.38") must lose the formula too.
  for (const address of inputCells()) {
    const cell = ws.getCell(address);
    if (!cell.isMerged || cell.master.address === address) cell.value = null;
  }

  // ---- header
  set('L10', toDate(report.reportDate));
  set('B11', report.supplierName ?? report.partyNameRaw);
  set('B12', report.poNumber);
  set('B13', report.truckNumber);
  set('I11', toDate(report.tokenDate));
  set('I12', report.tokenNumber);
  set('I13', report.grnNumber);
  ws.getCell('I13').numFmt = '@'; // the template formats the GRN cell as a date
  set('L12', report.invoiceNumber);
  set('L13', toDate(report.invoiceDate));

  // ---- weights
  for (const m of report.materials) {
    const col = MATERIAL_COLUMN[m.code];
    if (!col) continue;
    set(`${col}15`, m.invoiceWeightKg);
    set(`${col}16`, m.invoiceBales);
    set(`${col}17`, m.invoiceRate);
    set(`${col}18`, m.dalmiaWeightKg);
    set(`${col}19`, m.dalmiaBales);
    set(`${col}20`, m.dalmiaRate);
  }
  const w = out.weights;
  results.set('M15', w.totalInvoiceWeight).set('M16', w.totalInvoiceBales).set('M18', w.totalDalmiaWeight).set('M19', w.totalDalmiaBales);
  for (const d of w.differences) {
    const col = MATERIAL_COLUMN[d.materialCode];
    if (col) results.set(`${col}21`, d.differenceKg);
  }
  results.set('M21', w.totalDifference);

  // ---- bales and QC parameters
  report.baleWeightsKg.forEach((kg, i) => KG_COLUMNS[i] && set(`${KG_COLUMNS[i]}24`, kg));
  results.set('K24', out.totalBaleWeight);

  const offSeason = !isMonsoon(report.reportDate);
  const paramByCode = new Map<string, ParameterResult>(out.parameters.map((p) => [p.parameterCode, p]));
  const dirty = paramByCode.get(P.DIRTY_BOTTLE);
  const dirtyRow = parameterRow(P.DIRTY_BOTTLE, report.reportDate)!;
  // The engine config is not part of the DTO; the cut-off shows itself as "over norm but no amount".
  const dirtyCutOff = 6;
  for (const [address, formula] of Object.entries(dirtyBottleFormulas(dirtyRow, dirtyCutOff))) set(address, { formula });
  if (offSeason) {
    for (const [address, formula] of Object.entries(moistureFormulas(27))) set(address, { formula });
  }
  if (dirty) set(`O${dirtyRow}`, dirty.rate);

  for (const reading of report.readings) {
    const p = paramByCode.get(reading.parameterCode);
    const r = parameterRow(reading.parameterCode, report.reportDate);
    if (!p || !r) continue;
    const percent = p.inputMode === 'PERCENT_PER_BALE';
    reading.perBale.forEach((v, i) => {
      const col = (percent ? PERCENT_COLUMNS : KG_COLUMNS)[i];
      if (col) set(`${col}${r}`, v);
      if (!percent && PERCENT_COLUMNS[i] && p.balePercents[i] != null) results.set(`${PERCENT_COLUMNS[i]}${r}`, p.balePercents[i]!);
    });
    set(`D${r}`, p.normPercent);
    set(`N${r}`, reading.purchaseAdjustment || null);
    if (reading.affectedBales != null) set(`M${r}`, reading.affectedBales);

    if (p.totalKg != null) results.set(`K${r}`, p.totalKg);
    results.set(`L${r}`, p.actualPercent).set(`O${r}`, p.rate);
    results.set(`P${r}`, p.standardQty).set(`Q${r}`, p.standardAmount).set(`T${r}`, p.differenceQty).set(`U${r}`, p.differenceAmount);

    // The template's approved formulas read N as a concession in points; rewrite them for "purchase allowed".
    // Rows 28–30 have no Approved formulas at all; the app's approved figures go in as values.
    const hasApprovedFormula = isFormula(ws.getCell(`R${r}`).value);
    if (hasApprovedFormula) {
      set(`R${r}`, { formula: approvedQtyFormula(r) });
      set(`S${r}`, { formula: `${approvedQtyFormula(r)}*$O${r}` });
      results.set(`R${r}`, p.approvedQty).set(`S${r}`, p.approvedAmount);
    } else if (p.isDeductible) {
      set(`R${r}`, p.approvedQty);
      set(`S${r}`, p.approvedAmount);
    }
  }

  const sub = out.subtotals;
  const putAmounts = (row: number, a: typeof sub.discretionary, qtyToo = true) => {
    if (qtyToo) results.set(`P${row}`, a.standardQty).set(`R${row}`, a.approvedQty).set(`T${row}`, a.differenceQty);
    results.set(`Q${row}`, a.standardAmount).set(`S${row}`, a.approvedAmount).set(`U${row}`, a.differenceAmount);
  };
  // The template has no formula in R31, so its Total (A+B) approved qty leaves Moisture out.
  set('R31', { formula: 'SUBTOTAL(9,R26:R30)' });
  putAmounts(31, sub.discretionary);
  putAmounts(40, sub.nonDiscretionary);
  putAmounts(41, sub.contamination);

  // ---- shortage
  // The template takes row 47's quantity from the rate cell (=-L20); corrected so the file agrees with the app.
  set('O47', { formula: '-L21' });
  for (const l of out.shortage.lines) {
    const r = SHORTAGE_ROW[l.materialCode];
    if (!r) continue;
    results.set(`O${r}`, l.shortageQty).set(`P${r}`, l.rate).set(`Q${r}`, l.standardAmount).set(`U${r}`, l.differenceAmount);
    if (isFormula(ws.getCell(`R${r}`).value)) results.set(`R${r}`, l.approvedQty).set(`S${r}`, l.approvedAmount);
    else {
      set(`R${r}`, l.approvedQty);
      set(`S${r}`, l.approvedAmount);
    }
  }
  for (const s of report.shortageAdjustments) {
    const r = SHORTAGE_ROW[s.materialCode];
    if (r && r <= 45) set(`N${r}`, s.adjustmentQty ?? 0);
  }
  const other = report.otherDescriptions.find((d) => d.materialCode === M.OTHERS)?.description;
  set('A47', other ? `Other (Please Specify): ${other}` : 'Other (Please Specify)');
  results.set('Q48', out.shortage.subtotal.standardAmount).set('S48', out.shortage.subtotal.approvedAmount).set('U48', out.shortage.subtotal.differenceAmount);
  results.set('Q49', out.grandTotal.standardAmount).set('S49', out.grandTotal.approvedAmount).set('U49', out.grandTotal.differenceAmount);

  // ---- footer
  set('D50', report.weightTolerancePercent);
  results.set('K50', out.shortage.toleranceKg);
  set('B51', report.remarks);
  set('B54', report.checkedBy?.name ?? report.checkedByName);
  set('L54', report.approvedBy?.name ?? report.approvedByName);

  // Outside the print area: lets anyone confirm Excel's recalculation agrees with the app.
  set('V8', `Exported from the QC Debit Note app — ${report.reportNo} (${report.status})`);
  set('V9', 'Approved total (A+B+C) in the app:');
  set('V10', Math.round(out.grandTotal.approvedAmount * 100) / 100);

  refreshCachedResults(ws, results);
  wb.calcProperties.fullCalcOnLoad = true;
  ws.name = SHEET_NAME;
  return wb;
}

/** A blank copy of the sheet: all sample inputs removed, formulas intact. */
export async function buildBlankTemplate(): Promise<ExcelJS.Workbook> {
  const wb = await loadTemplate();
  const ws = wb.getWorksheet(SHEET_NAME)!;
  for (const address of inputCells()) {
    const cell = ws.getCell(address);
    if (!cell.isMerged || cell.master.address === address) cell.value = null;
  }
  refreshCachedResults(ws, new Map());
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

export const exportFileName = (report: ReportDto, ext: 'xlsx' | 'pdf'): string =>
  `${[report.reportNo, report.truckNumber].filter(Boolean).join(' ').replace(/[^A-Za-z0-9 _-]+/g, '-')}.${ext}`;
