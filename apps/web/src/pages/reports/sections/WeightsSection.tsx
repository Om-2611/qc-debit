import type { EngineOutput } from '@dalmia/calc';
import type { ReportMaterialDto } from '@dalmia/types';
import { NumberField } from '../../../components/NumberField';
import { SectionCard } from '../../../components/SectionCard';
import { formatQty } from '../../../lib/format';
import type { Draft } from '../draft';

type NumericKey = Exclude<keyof ReportMaterialDto, 'code' | 'name'>;

const ROWS: { key: NumericKey; group: string; label: string; total?: 'invoiceWeight' | 'dalmiaWeight' | 'invoiceBales' | 'dalmiaBales' }[] = [
  { key: 'invoiceWeightKg', group: 'As per Supplier Invoice', label: 'Weight (kg)', total: 'invoiceWeight' },
  { key: 'invoiceBales', group: 'As per Supplier Invoice', label: 'No. of bales', total: 'invoiceBales' },
  { key: 'invoiceRate', group: 'As per Supplier Invoice', label: 'Rate (₹/kg)' },
  { key: 'dalmiaWeightKg', group: 'As per Dalmia', label: 'Weight (kg)', total: 'dalmiaWeight' },
  { key: 'dalmiaBales', group: 'As per Dalmia', label: 'No. of bales', total: 'dalmiaBales' },
  { key: 'dalmiaRate', group: 'As per Dalmia', label: 'Rate (₹/kg)' },
];

interface Props {
  draft: Draft;
  output: EngineOutput;
  /** Rows 15–17, typed at the gate. */
  invoiceEditable: boolean;
  /** Rows 18–20, typed by the Raw Material Store. */
  dalmiaEditable: boolean;
  onChange: (code: string, key: NumericKey, value: number | null) => void;
  /** Rates and ₹ are stripped for this user: the two rate rows are not shown at all. */
  ratesHidden: boolean;
}

export function WeightsSection({ draft, output, invoiceEditable, dalmiaEditable, onChange, ratesHidden }: Props) {
  const rows = ratesHidden ? ROWS.filter((r) => !r.key.endsWith('Rate')) : ROWS;
  // The Dalmia rate comes from the PO, so the gate types it with the invoice rows; the store types weight and bales.
  const editableFor = (key: NumericKey) => (key.startsWith('invoice') || key === 'dalmiaRate' ? invoiceEditable : dalmiaEditable);
  const w = output.weights;
  const totals = {
    invoiceWeight: w.totalInvoiceWeight,
    dalmiaWeight: w.totalDalmiaWeight,
    invoiceBales: w.totalInvoiceBales,
    dalmiaBales: w.totalDalmiaBales,
  };

  return (
    <SectionCard
      label="Weights"
      title="As per Supplier Invoice and As per Dalmia"
      owner="Gate (invoice rows + Dalmia rate) · Raw Material Store (Dalmia weight, bales)"
      editable={invoiceEditable || dalmiaEditable}
    >
      <div className="sheet-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Particulars</th>
              {draft.materials.map((m) => (
                <th key={m.code}>
                  {m.name}
                  {w.dominantMaterialCode === m.code && w.totalDalmiaWeight > 0 && (
                    <div className="muted" title="Largest Dalmia weight: its rate drives the contamination deductions">
                      dominant
                    </div>
                  )}
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <span className="muted">{row.group} · </span>
                  {row.label}
                </th>
                {draft.materials.map((m) => (
                  <td key={m.code} className="num">
                    <NumberField
                      aria-label={`${row.group}, ${m.name}, ${row.label}`}
                      value={m[row.key]}
                      disabled={!editableFor(row.key)}
                      onChange={(v) => onChange(m.code, row.key, v)}
                    />
                  </td>
                ))}
                <td className="num" style={{ fontWeight: 700 }}>
                  {row.total ? formatQty(totals[row.total]) : ''}
                </td>
              </tr>
            ))}
            <tr className="subtotal-row">
              <th scope="row">Difference (Dalmia − Invoice), kg</th>
              {w.differences.map((d) => (
                <td key={d.materialCode} className={`num ${d.differenceKg < 0 ? 'negative' : ''}`}>
                  {formatQty(d.differenceKg)}
                </td>
              ))}
              <td className={`num ${w.totalDifference < 0 ? 'negative' : ''}`}>{formatQty(w.totalDifference)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
