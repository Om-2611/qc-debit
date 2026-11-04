import { Fragment } from 'react';
import { usesAffectedBales, type DeductionAmounts, type EngineOutput, type ParameterResult } from '@dalmia/calc';
import { BALE_COUNT } from '@dalmia/types';
import { NumberField } from '../../../components/NumberField';
import { SectionCard } from '../../../components/SectionCard';
import { formatAmount, formatPercent, formatQty } from '../../../lib/format';
import type { Draft } from '../draft';

interface Props {
  draft: Draft;
  output: EngineOutput;
  qcEditable: boolean;
  approvalEditable: boolean;
  onBaleWeight: (index: number, value: number | null) => void;
  onReading: (parameterCode: string, index: number, value: number | null) => void;
  onAdjustment: (parameterCode: string, value: number | null) => void;
  onAffectedBales: (parameterCode: string, value: number | null) => void;
  /** Rates and ₹ are stripped for this user: show quantities only. */
  ratesHidden: boolean;
}

const BALES = Array.from({ length: BALE_COUNT }, (_, i) => i);
function AmountCells({ a, ratesHidden }: { a: DeductionAmounts; ratesHidden: boolean }) {
  return (
    <>
      <td className="num">{formatQty(a.standardQty)}</td>
      {!ratesHidden && <td className="num">{formatAmount(a.standardAmount)}</td>}
      <td className="num">{formatQty(a.approvedQty)}</td>
      {!ratesHidden && <td className="num">{formatAmount(a.approvedAmount)}</td>}
      <td className={`num ${a.differenceQty < 0 ? 'negative' : ''}`}>{formatQty(a.differenceQty)}</td>
      {!ratesHidden && <td className={`num ${a.differenceAmount < 0 ? 'negative' : ''}`}>{formatAmount(a.differenceAmount)}</td>}
    </>
  );
}

export function QcSection({
  draft,
  output,
  qcEditable,
  approvalEditable,
  onBaleWeight,
  onReading,
  onAdjustment,
  onAffectedBales,
  ratesHidden,
}: Props) {
  const COLUMNS = 6 + BALE_COUNT + (ratesHidden ? 3 : 7); // for full-width group header rows
  const readingFor = (code: string) => draft.readings.find((r) => r.parameterCode === code);

  const parameterRow = (p: ParameterResult) => {
    const reading = readingFor(p.parameterCode);
    const isPercent = p.inputMode === 'PERCENT_PER_BALE';
    const hasData = p.actualPercent > 0;
    const perBale = usesAffectedBales(p.weightBase);
    const baseLabel =
      p.weightBase === 'CLEAR_WEIGHT'
        ? 'on Clear'
        : p.weightBase === 'AFFECTED_BALES_TRUCK_AVG'
          ? '× avg truck bale'
          : p.weightBase === 'AFFECTED_BALES_SAMPLE_AVG'
            ? '× avg sample bale'
            : 'on total';
    return (
      <tr key={p.parameterCode}>
        <th scope="row">
          {p.name}
          {!p.isDeductible && (
            <span className="muted" title="Recorded and highlighted, but switched off for deduction in Settings">
              {' '}
              · not deducted
            </span>
          )}
        </th>
        <td className="num" title={p.normSeasonLabel ? `Norm for ${p.normSeasonLabel}` : 'Norm (all year)'}>
          {formatPercent(p.normPercent)}
          {p.normSeasonLabel && <div className="muted">{p.normSeasonLabel}</div>}
        </td>
        {BALES.map((i) => (
          <td key={i} className="num">
            <NumberField
              aria-label={`${p.name}, bale ${i + 1}, ${isPercent ? 'percent' : 'kg'}`}
              value={reading?.perBale[i] ?? null}
              max={isPercent ? 100 : undefined}
              disabled={!qcEditable}
              onChange={(v) => onReading(p.parameterCode, i, v)}
            />
            {/* Per-bale % for kg readings, as the sheet shows beside each kg column */}
            {/* The typed value is always kg (or % for Moisture); the share of the bale is shown beside the unit, never instead of it. */}
            <div className="muted">
              {isPercent ? '%' : p.balePercents[i] != null ? `kg = ${formatPercent(p.balePercents[i])} % of bale` : 'kg'}
            </div>
          </td>
        ))}
        <td className="num">{p.totalKg == null ? '—' : formatQty(p.totalKg)}</td>
        <td className={`num ${hasData ? (p.overNorm ? 'over-norm' : 'within-norm') : ''}`}>{formatPercent(p.actualPercent)}</td>
        <td className="num">
          {/* Sheet column M: only the per-affected-bale parameters (Dirty bottle, Jar-PET) use it */}
          {perBale && (
            <NumberField
              aria-label={`${p.name}, number of bales affected`}
              value={reading?.affectedBales ?? null}
              width={64}
              disabled={!qcEditable}
              onChange={(v) => onAffectedBales(p.parameterCode, v)}
            />
          )}
        </td>
        <td className="num">
          <NumberField
            aria-label={`${p.name}, purchase allowed, percentage points`}
            value={reading?.purchaseAdjustment ?? null}
            // Between the norm (D) and the actual % (L); the server explains a value below the norm.
            max={Math.max(p.actualPercent, p.normPercent)}
            width={72}
            disabled={!approvalEditable}
            onChange={(v) => onAdjustment(p.parameterCode, v)}
          />
        </td>
        {!ratesHidden && (
          <td className="num" title={`Excess % is applied to ${formatQty(p.weightBaseKg)} kg`}>
            {formatQty(p.rate)}
            <div className="muted">{p.beyondCutOff ? 'not charged at this level' : baseLabel}</div>
          </td>
        )}
        <AmountCells a={p} ratesHidden={ratesHidden} />
      </tr>
    );
  };

  const group = (label: string, category: ParameterResult['category'], subtotal: DeductionAmounts, subtotalLabel: string) => (
    <Fragment key={category}>
      <tr className="group-row">
        <th colSpan={COLUMNS} scope="colgroup">
          <span className="section-label">{label}</span>
        </th>
      </tr>
      {output.parameters.filter((p) => p.category === category).map(parameterRow)}
      <tr className="subtotal-row">
        <th scope="row" colSpan={6 + BALE_COUNT}>
          {subtotalLabel}
        </th>
        {!ratesHidden && <td />}
        <AmountCells a={subtotal} ratesHidden={ratesHidden} />
      </tr>
    </Fragment>
  );

  return (
    <SectionCard
      label="Quality check"
      title="Bale weights and QC parameters"
      owner="QC Analyst · Purchase allowed by Purchase Manager"
      editable={qcEditable || approvalEditable}
    >
      <div className="sheet-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ minWidth: 190 }}>QC Parameters</th>
              <th>Norm %</th>
              {BALES.map((i) => (
                <th key={i}>Bale {i + 1}</th>
              ))}
              <th>Total kg</th>
              <th>Actual %</th>
              <th>No. of Bales</th>
              <th>Purchase allowed</th>
              {!ratesHidden && <th>Rate</th>}
              <th>Std Qty</th>
              {!ratesHidden && <th>Std Amt ₹</th>}
              <th>Appr Qty</th>
              {!ratesHidden && <th>Appr Amt ₹</th>}
              <th>Diff Qty</th>
              {!ratesHidden && <th>Diff Amt ₹</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Bale weight (kg)</th>
              <td />
              {BALES.map((i) => (
                <td key={i} className="num">
                  <NumberField
                    aria-label={`Bale ${i + 1} weight, kg`}
                    value={draft.baleWeightsKg[i] ?? null}
                    disabled={!qcEditable}
                    onChange={(v) => onBaleWeight(i, v)}
                  />
                </td>
              ))}
              <td className="num" style={{ fontWeight: 700 }}>
                {formatQty(output.totalBaleWeight)}
              </td>
              <td colSpan={ratesHidden ? 6 : 10} />
            </tr>
            {group('A) Discretionary', 'DISCRETIONARY', output.subtotals.discretionary, 'A) Sub Total')}
            {group('B) Non-discretionary', 'NON_DISCRETIONARY', output.subtotals.nonDiscretionary, 'B) Sub Total')}
            <tr className="subtotal-row">
              <th scope="row" colSpan={6 + BALE_COUNT}>
                Total (A+B)
              </th>
              {!ratesHidden && <td />}
              <AmountCells a={output.subtotals.contamination} ratesHidden={ratesHidden} />
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
