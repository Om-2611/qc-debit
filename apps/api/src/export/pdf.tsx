import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { DeductionAmounts } from '@dalmia/calc';
import { STATUS_LABELS, type ReportDto } from '@dalmia/types';

// ---------------------------------------------------------------- brand (same tokens as the web app)

const C = {
  primary: '#005051',
  primaryLight: '#E0EDED',
  text: '#1E1E1E',
  secondary: '#565656',
  surface: '#F5F5F5',
  border: '#DBDBDB',
  danger: '#C62828',
  success: '#2E7D32',
};

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const fontFile = (pkg: string, file: string): string => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files', file);

let fontsRegistered = false;
function registerFonts(): void {
  if (fontsRegistered) return;
  Font.register({
    family: 'Nunito Sans',
    fonts: [400, 700, 800].map((w) => ({ src: fontFile('@fontsource/nunito-sans', `nunito-sans-latin-${w}-normal.woff`), fontWeight: w })),
  });
  Font.register({
    family: 'JetBrains Mono',
    fonts: [400, 700].map((w) => ({ src: fontFile('@fontsource/jetbrains-mono', `jetbrains-mono-latin-${w}-normal.woff`), fontWeight: w })),
  });
  Font.registerHyphenationCallback((word) => [word]); // never split truck or GRN numbers
  fontsRegistered = true;
}

/** Logo needs the client's written OK; when the file is absent the PDF falls back to a wordmark. */
let logoCache: { data: Buffer; format: 'png' } | null | undefined;
function logo(): { data: Buffer; format: 'png' } | null {
  if (logoCache !== undefined) return logoCache;
  logoCache = null;
  // Passed as bytes: the renderer mistakes a Windows path ("C:…") for a URL and tries to fetch it.
  for (const p of [path.resolve(HERE, '../../assets/logo.png'), path.resolve(HERE, '../assets/logo.png')]) {
    if (fs.existsSync(p)) {
      logoCache = { data: fs.readFileSync(p), format: 'png' };
      break;
    }
  }
  return logoCache;
}

// ---------------------------------------------------------------- formatting

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const money = (v: number | null | undefined): string => (v == null ? '' : inr.format(Math.abs(v) < 0.005 ? 0 : v));
const percent = (v: number | null | undefined): string => (v == null ? '' : pct.format(v));
const date = (iso: string | null): string => (iso ? iso.slice(0, 10).split('-').reverse().join('-') : '');
const dateTime = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
        .format(new Date(iso))
        .replace(/\//g, '-')
        .replace(',', '')
    : '';

// ---------------------------------------------------------------- styles

const s = StyleSheet.create({
  page: { fontFamily: 'Nunito Sans', fontSize: 7, color: C.text, paddingTop: 16, paddingBottom: 24, paddingHorizontal: 24 },
  strip: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: C.primary },
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 5, marginBottom: 4 },
  company: { fontSize: 10, fontWeight: 800 },
  label: { fontSize: 6, fontWeight: 700, letterSpacing: 0.6, color: C.secondary, textTransform: 'uppercase' },
  title: { fontSize: 12, fontWeight: 800, color: C.primary },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 2, borderWidth: 0.8, borderColor: C.primary, paddingHorizontal: 4, paddingTop: 2 },
  box: { borderWidth: 0.8, borderColor: C.primary, marginTop: 3 },
  boxTitle: { backgroundColor: C.primaryLight, color: C.primary, fontSize: 6.5, fontWeight: 700, letterSpacing: 0.6, paddingHorizontal: 4, paddingVertical: 0.8, borderBottomWidth: 0.5, borderBottomColor: C.primary },
  narration: { marginTop: 3, borderWidth: 1.2, borderColor: C.primary, backgroundColor: '#FFF3D6', paddingHorizontal: 5, paddingVertical: 3 },
  narrationLine: { fontSize: 7.2, fontWeight: 700, lineHeight: 1.35 },
  field: { width: '20%', paddingRight: 6, marginBottom: 1, borderBottomWidth: 0.3, borderBottomColor: C.border },
  sectionLabel: { fontSize: 6.5, fontWeight: 700, letterSpacing: 0.6, color: C.secondary, marginTop: 2, marginBottom: 0.5 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.border, alignItems: 'stretch', minHeight: 8.6 },
  head: { backgroundColor: C.surface, fontWeight: 700, color: C.secondary, fontSize: 6.2 },
  zebra: { backgroundColor: C.surface },
  subtotal: { backgroundColor: C.primaryLight, fontWeight: 700 },
  total: { backgroundColor: C.primary, color: '#FFFFFF', fontWeight: 700 },
  cell: { paddingHorizontal: 3, paddingVertical: 0.2, borderRightWidth: 0.4, borderRightColor: C.border, justifyContent: 'center' },
  num: { fontFamily: 'JetBrains Mono', fontSize: 6.4, textAlign: 'right' },
  watermark: { position: 'absolute', top: 230, left: 120, fontSize: 64, fontWeight: 800, color: '#00000010', transform: 'rotate(-24deg)' },
  footer: { position: 'absolute', bottom: 12, left: 24, right: 24, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6, color: C.secondary },
});

interface Column {
  w: number; // flex weight
  num?: boolean;
}

function Row({ cols, cells, style }: { cols: Column[]; cells: ReactNode[]; style?: object | object[] }) {
  return (
    <View style={[s.row, ...(Array.isArray(style) ? style : style ? [style] : [])]} wrap={false}>
      {cols.map((c, i) => (
        <View key={i} style={[s.cell, { flex: c.w }]}>
          {typeof cells[i] === 'string' || typeof cells[i] === 'number' ? <Text style={c.num ? s.num : undefined}>{cells[i]}</Text> : cells[i]}
        </View>
      ))}
    </View>
  );
}

const Field = ({ label, value }: { label: string; value: string | null }) => (
  <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    <Text>{value || '—'}</Text>
  </View>
);

const amounts = (a: DeductionAmounts): string[] => [
  money(a.standardQty),
  money(a.standardAmount),
  money(a.approvedQty),
  money(a.approvedAmount),
  money(a.differenceAmount),
];

/**
 * "Being Debit Note for A-1 (…), B-2 (…), Weight Short-3 (…) and GRN No. X." → two lines: the contamination
 * items, then the shortage items with the GRN. A narration with no shortage splits its items in half.
 */
function narrationLines(narration: string): string[] {
  const m = /^(Being Debit Note for )(.*?)( and GRN No\. .*?)?\.?$/.exec(narration.trim());
  if (!m) return [narration];
  const items = m[2]!.split(', ');
  const tail = m[3] ?? '';
  let cut = items.findIndex((it) => /^(Weight Short|Excess Green|.* Short)-/.test(it));
  if (cut <= 0) cut = Math.ceil(items.length / 2);
  const first = items.slice(0, cut).join(', ');
  const second = items.slice(cut).join(', ');
  return second ? [`${m[1]}${first},`, `${second}${tail}.`] : [`${m[1]}${first}${tail}.`];
}

// ---------------------------------------------------------------- document

function ReportDocument({ report }: { report: ReportDto }) {
  const out = report.output;
  const logoImage = logo();
  const approved = report.status === 'APPROVED';

  const wCols: Column[] = [{ w: 2.4 }, ...report.materials.map(() => ({ w: 1, num: true })), { w: 1, num: true }];
  const weightRows: [string, (m: ReportDto['materials'][number]) => number | null, number | null][] = [
    ['Supplier invoice · Weight (kg)', (m) => m.invoiceWeightKg, out.weights.totalInvoiceWeight],
    ['Supplier invoice · No. of bales', (m) => m.invoiceBales, out.weights.totalInvoiceBales || null],
    ['Supplier invoice · Rate', (m) => m.invoiceRate, null],
    ['Dalmia · Weight (kg)', (m) => m.dalmiaWeightKg, out.weights.totalDalmiaWeight],
    ['Dalmia · No. of bales', (m) => m.dalmiaBales, out.weights.totalDalmiaBales || null],
    ['Dalmia · Rate', (m) => m.dalmiaRate, null],
  ];

  const qCols: Column[] = [
    { w: 2.3 },
    { w: 0.8, num: true },
    { w: 0.9, num: true },
    { w: 0.9, num: true },
    { w: 0.9, num: true },
    { w: 0.9, num: true },
    { w: 1, num: true },
    { w: 0.7, num: true },
    { w: 0.8, num: true },
    { w: 0.9, num: true },
    { w: 1.1, num: true },
    { w: 1.4, num: true },
    { w: 1.1, num: true },
    { w: 1.4, num: true },
    { w: 1.3, num: true },
  ];
  const qHead = ['QC parameter', 'Norm %', 'Bale 1', 'Bale 2', 'Bale 3', 'Total kg', 'Actual %', 'Bales', 'Allowed', 'Rate', 'Std qty', 'Std amt', 'Appr qty', 'Appr amt', 'Diff amt'];
  const blank = (n: number) => Array.from({ length: n }, () => '');

  const group = (title: string, category: 'DISCRETIONARY' | 'NON_DISCRETIONARY', sub: DeductionAmounts, subLabel: string) => (
    <View>
      <Text style={s.sectionLabel}>{title}</Text>
      {out.parameters
        .filter((p) => p.category === category)
        .map((p, i) => {
          const reading = report.readings.find((r) => r.parameterCode === p.parameterCode);
          const unit = p.inputMode === 'PERCENT_PER_BALE' ? '%' : '';
          return (
            <Row
              key={p.parameterCode}
              cols={qCols}
              style={i % 2 ? s.zebra : undefined}
              cells={[
                `${p.name}${p.isDeductible ? '' : ' (not deducted)'}`,
                percent(p.normPercent),
                ...[0, 1, 2].map((b) => (reading?.perBale[b] == null ? '' : `${reading.perBale[b]}${unit}`)),
                p.totalKg == null ? '' : money(p.totalKg),
                <Text key="a" style={[s.num, p.actualPercent > 0 ? { color: p.overNorm ? C.danger : C.success, fontWeight: 700 } : {}]}>
                  {percent(p.actualPercent)}
                </Text>,
                p.affectedBales == null ? '' : String(p.affectedBales),
                p.purchaseAdjustment ? String(p.purchaseAdjustment) : '',
                money(p.rate),
                ...amounts(p),
              ]}
            />
          );
        })}
      <Row cols={qCols} style={s.subtotal} cells={[subLabel, ...blank(9), ...amounts(sub)]} />
    </View>
  );

  const sCols: Column[] = [{ w: 3.2 }, { w: 1, num: true }, { w: 1, num: true }, { w: 1, num: true }, { w: 1.3, num: true }, { w: 1, num: true }, { w: 1, num: true }, { w: 1.3, num: true }, { w: 1.3, num: true }];
  const other = report.otherDescriptions.find((d) => d.materialCode === 'OTHERS')?.description;
  const shortageName = (code: string, name: string): string =>
    code === 'CLEAR' ? 'Clear — weight short' : code === 'BARWASTE' ? 'Barwaste — premium over Clear' : code === 'GREEN' ? 'Green — excess, at price difference' : code === 'OTHERS' ? `Other${other ? `: ${other}` : ''}` : name;

  // Materials that are not on this truck would only add rows of zeros.
  const onTruck = new Set(report.materials.filter((m) => (m.invoiceWeightKg ?? 0) > 0 || (m.dalmiaWeightKg ?? 0) > 0).map((m) => m.code));
  const shortageLines = out.shortage.lines.filter((l) => onTruck.has(l.materialCode) || l.materialCode === 'CLEAR');

  return (
    <Document title={`QC Report ${report.reportNo}`} author="Dalmia Polypro Industries Private Limited" subject="DPIPL/QA/F-11">
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.strip} fixed />
        {!approved && (
          <Text style={s.watermark} fixed>
            NOT APPROVED
          </Text>
        )}

        <View style={s.header}>
          {logoImage ? <Image src={logoImage} style={{ width: 118, height: 21.8, marginRight: 12 }} /> : <Text style={[s.company, { marginRight: 12 }]}>Dalmia Polypro</Text>}
          <View style={{ flex: 1 }}>
            <Text style={s.company}>Dalmia Polypro Industries Private Limited</Text>
            <Text style={{ color: C.secondary }}>GAT No. 236, Lakhmapur, Nasik, PIN-422202, Maharashtra, INDIA</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.label}>DPIPL/QA/F-11</Text>
            <Text style={s.title}>QC Report</Text>
            <Text>
              {report.reportNo} · {STATUS_LABELS[report.status]}
            </Text>
          </View>
        </View>

        <View style={s.fieldGrid}>
          <Field label="Party name" value={report.supplierName ?? report.partyNameRaw} />
          <Field label="Token Dt." value={date(report.tokenDate)} />
          <Field label="Invoice No." value={report.invoiceNumber} />
          <Field label="Date" value={date(report.reportDate)} />
          <Field label="PO No." value={report.poNumber} />
          <Field label="Token No." value={report.tokenNumber} />
          <Field label="Invoice Dt." value={date(report.invoiceDate)} />
          <Field label="Truck No." value={report.truckNumber} />
          <Field label="GRN No." value={report.grnNumber} />
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>WEIGHTS — AS PER SUPPLIER INVOICE / AS PER DALMIA</Text>
        <Row cols={wCols} style={s.head} cells={['Particulars', ...report.materials.map((m) => m.name), 'Total']} />
        {weightRows.map(([label, pick, total], i) => (
          <Row key={label} cols={wCols} style={i % 2 ? s.zebra : undefined} cells={[label, ...report.materials.map((m) => money(pick(m))), money(total)]} />
        ))}
        <Row cols={wCols} style={s.subtotal} cells={['Difference (Dalmia − Invoice), kg', ...out.weights.differences.map((d) => money(d.differenceKg)), money(out.weights.totalDifference)]} />
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>QC PARAMETERS</Text>
          <Row cols={qCols} style={s.head} cells={qHead} />
          <Row cols={qCols} cells={['Bale weight (kg)', '', ...[0, 1, 2].map((b) => (report.baleWeightsKg[b] == null ? '' : String(report.baleWeightsKg[b]))), money(out.totalBaleWeight), ...blank(9)]} />
        {group('A) DISCRETIONARY', 'DISCRETIONARY', out.subtotals.discretionary, 'A) Sub Total')}
        {group('B) NON-DISCRETIONARY', 'NON_DISCRETIONARY', out.subtotals.nonDiscretionary, 'B) Sub Total')}
        <Row cols={qCols} style={s.subtotal} cells={['Total (A+B)', ...blank(9), ...amounts(out.subtotals.contamination)]} />
        </View>

        <View style={s.box}>
          <Text style={s.boxTitle}>C) SHORTAGE</Text>
        <Row cols={sCols} style={s.head} cells={['Material', 'Shortage qty', 'Rate', 'Charged at', 'Std amt', 'Appr qty', 'Adj. kg', 'Appr amt', 'Diff amt']} />
        {shortageLines.map((l, i) => (
          <Row
            key={l.materialCode}
            cols={sCols}
            style={i % 2 ? s.zebra : undefined}
            cells={[shortageName(l.materialCode, l.materialName), money(l.shortageQty), money(l.rate), money(l.amountRate), money(l.standardAmount), money(l.approvedQty), l.adjustmentQty ? money(l.adjustmentQty) : '', money(l.approvedAmount), money(l.differenceAmount)]}
          />
        ))}
        <Row cols={sCols} style={s.subtotal} cells={['C) Sub Total', '', '', '', money(out.shortage.subtotal.standardAmount), '', '', money(out.shortage.subtotal.approvedAmount), money(out.shortage.subtotal.differenceAmount)]} />
        <Row
          cols={sCols}
          style={s.total}
          cells={['Total (A+B+C)  ·  INR', '', '', '', money(out.grandTotal.standardAmount), '', '', money(out.grandTotal.approvedAmount), money(out.grandTotal.differenceAmount)]}
        />
        </View>

        <View style={[s.box, { flexDirection: 'row', padding: 4 }]} wrap={false}>
          <View style={{ width: '16%', paddingRight: 8 }}>
            <Text style={s.label}>Weight tolerance</Text>
            <Text>{report.weightTolerancePercent == null ? '—' : `${report.weightTolerancePercent}% = ${money(out.shortage.toleranceKg)} kg`}</Text>
          </View>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={s.label}>Remarks</Text>
            <Text>{report.remarks || '—'}</Text>
          </View>
          <View style={{ width: '17%', paddingRight: 8 }}>
            <Text style={s.label}>Checked by</Text>
            <Text style={{ fontWeight: 700 }}>{report.checkedBy?.name ?? report.checkedByName ?? '—'}</Text>
          </View>
          <View style={{ width: '22%' }}>
            <Text style={s.label}>Approved by</Text>
            <Text style={{ fontWeight: 700 }}>{report.approvedBy?.name ?? report.approvedByName ?? '—'}</Text>
            {report.approvedAt && <Text style={{ color: C.secondary }}>{dateTime(report.approvedAt)} IST</Text>}
          </View>
        </View>

        {report.narration && (
          <View style={s.narration} wrap={false}>
            <Text style={[s.label, { color: C.primary }]}>Tally narration</Text>
            {narrationLines(report.narration).map((line, i) => (
              <Text key={i} style={s.narrationLine}>
                {line}
              </Text>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>
            {report.reportNo} · generated {dateTime(new Date().toISOString())} IST
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(report: ReportDto): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportDocument report={report} />);
}
