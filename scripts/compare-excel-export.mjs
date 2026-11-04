// Reads the JSON printed by verify-excel-export.ps1 (Excel's recalculated values) from stdin and
// compares it with the figures the app cached in the same exported files.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ExcelJS = createRequire(path.join(here, '../apps/api/package.json'))('exceljs');
const dir = path.join(here, '../apps/api/tmp');

let text = '';
for await (const chunk of process.stdin) text += chunk;
const fromExcel = JSON.parse(text.replace(/^﻿/, ''));

// The app stores figures at 4 dp; Excel keeps full precision.
const TOLERANCE = 1e-3;
const RESULT_COLUMNS = /^[PQRSU]\d+$/;

let failures = 0;
for (const [file, excelValues] of Object.entries(fromExcel)) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, file));
  const ws = wb.getWorksheet('Format');
  let compared = 0;
  const problems = [];
  for (const [address, excelValue] of Object.entries(excelValues)) {
    const raw = ws.getCell(address).value;
    const isFormula = raw && typeof raw === 'object' && 'formula' in raw;
    const app = isFormula ? raw.result : raw;
    if (typeof excelValue === 'string') {
      problems.push(`${address}: Excel shows "${excelValue}"`);
      continue;
    }
    if (app === undefined || app === null) {
      // No figure from the app for this cell: Excel must have worked out nothing too.
      if (RESULT_COLUMNS.test(address) && Math.abs(excelValue) > TOLERANCE) problems.push(`${address}: Excel ${excelValue}, app has no value`);
      continue;
    }
    compared++;
    if (Math.abs(excelValue - app) > TOLERANCE) problems.push(`${address}: Excel ${excelValue} ≠ app ${app}`);
  }
  failures += problems.length;
  console.log(`${problems.length ? 'FAIL' : 'OK  '} ${file}: ${compared} cells compared, Q49=${excelValues.Q49} S49=${excelValues.S49}`);
  for (const p of problems) console.log(`       ${p}`);
}
process.exit(failures ? 1 : 0);
