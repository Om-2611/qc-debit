import { Box, TextField, Typography } from '@mui/material';
import type { EngineOutput, ShortageLineResult } from '@dalmia/calc';
import type { ReportDto } from '@dalmia/types';
import { NumberField } from '../../../components/NumberField';
import { SectionCard } from '../../../components/SectionCard';
import { formatAmount, formatDateTime, formatQty } from '../../../lib/format';
import type { Draft } from '../draft';

interface Props {
  draft: Draft;
  report: ReportDto;
  output: EngineOutput;
  editable: boolean;
  onAdjustment: (materialCode: string, value: number | null) => void;
  onOtherDescription: (materialCode: string, value: string | null) => void;
  onTolerance: (value: number | null) => void;
  onRemarks: (value: string | null) => void;
  /** Rates and ₹ are stripped for this user: show quantities only. */
  ratesHidden: boolean;
}

const LABEL: Record<ShortageLineResult['kind'], (l: ShortageLineResult) => string> = {
  WEIGHT_SHORT: (l) => `${l.materialName} — weight short`,
  PRICE_PREMIUM: (l) => `${l.materialName} — price premium over Clear`,
  EXCESS_GREEN: (l) => `${l.materialName} — excess, at price difference`,
  OTHER: (l) => (l.materialCode === 'OTHERS' ? 'Other (Please Specify)' : l.materialName),
};

const HINT: Partial<Record<ShortageLineResult['kind'], string>> = {
  WEIGHT_SHORT: 'Charged on the total shortfall of the truck at the Clear rate, once beyond tolerance',
  PRICE_PREMIUM: 'The kg are already charged in the Clear row; this adds (Barwaste rate − Clear rate)',
  EXCESS_GREEN: 'Charged when more Green arrives than invoiced, at (Green rate − Clear rate)',
};

export function ShortageSection({ draft, report, output, editable, onAdjustment, onOtherDescription, onTolerance, onRemarks, ratesHidden }: Props) {
  const money = (v: number) => (ratesHidden ? null : <td className="num">{formatAmount(v)}</td>);
  const s = output.shortage;
  const total = output.grandTotal;

  return (
    <SectionCard label="C) Shortage" title="Weight shortage and totals" owner="Purchase Manager" editable={editable}>
      <div className="sheet-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ minWidth: 300 }}>Material</th>
              <th>Shortage Qty</th>
              {!ratesHidden && <th>Rate</th>}
              {!ratesHidden && <th>Charged at</th>}
              {!ratesHidden && <th>Std Amt ₹</th>}
              <th>Appr Qty</th>
              <th>Adjustment kg</th>
              {!ratesHidden && <th>Appr Amt ₹</th>}
              {!ratesHidden && <th>Diff Amt ₹</th>}
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.materialCode}>
                <th scope="row" title={HINT[l.kind]}>
                  {LABEL[l.kind](l)}
                  {l.materialCode === 'OTHERS' && (
                    <input
                      className="cell-input text"
                      style={{ width: 170, marginLeft: 8 }}
                      aria-label="Other material description"
                      placeholder="Please specify"
                      maxLength={200}
                      disabled={!editable}
                      value={draft.otherDescriptions[l.materialCode] ?? ''}
                      onChange={(e) => onOtherDescription(l.materialCode, e.target.value || null)}
                    />
                  )}
                </th>
                <td className={`num ${l.shortageQty > 0 ? 'negative' : ''}`}>{formatQty(l.shortageQty)}</td>
                {!ratesHidden && <td className="num">{formatQty(l.rate)}</td>}
                {!ratesHidden && <td className="num">{formatQty(l.amountRate)}</td>}
                {money(l.standardAmount)}
                <td className="num">{formatQty(l.approvedQty)}</td>
                <td className="num">
                  {l.kind === 'WEIGHT_SHORT' || l.kind === 'PRICE_PREMIUM' ? (
                    <NumberField
                      aria-label={`${l.materialName}, shortage adjustment, kg`}
                      value={draft.shortageAdjustments[l.materialCode] ?? null}
                      disabled={!editable}
                      onChange={(v) => onAdjustment(l.materialCode, v)}
                    />
                  ) : (
                    <span className="muted">n/a</span>
                  )}
                </td>
                {money(l.approvedAmount)}
                {!ratesHidden && <td className={`num ${l.differenceAmount < 0 ? 'negative' : ''}`}>{formatAmount(l.differenceAmount)}</td>}
              </tr>
            ))}
            {ratesHidden && (
              <tr className="subtotal-row">
                <th scope="row" colSpan={4}>
                  Amounts are not shown for your account
                </th>
              </tr>
            )}
            {!ratesHidden && (
              <>
            <tr className="subtotal-row">
              <th scope="row" colSpan={4}>
                C) Sub Total
              </th>
              <td className="num">{formatAmount(s.subtotal.standardAmount)}</td>
              <td colSpan={2} />
              <td className="num">{formatAmount(s.subtotal.approvedAmount)}</td>
              <td className="num">{formatAmount(s.subtotal.differenceAmount)}</td>
            </tr>
            <tr className="total-row">
              <th scope="row" colSpan={4}>
                Total (A+B+C)
              </th>
              <td className="num">{formatAmount(total.standardAmount)}</td>
              <td colSpan={2} />
              <td className="num">{formatAmount(total.approvedAmount)}</td>
              <td className="num">{formatAmount(total.differenceAmount)}</td>
            </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <Box sx={{ p: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '320px 1fr' } }}>
        <Box>
          <Typography className="section-label" sx={{ mb: 0.5 }}>
            Weight tolerance
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <NumberField aria-label="Weight tolerance percent" value={draft.weightTolerancePercent} max={100} width={72} disabled={!editable} onChange={onTolerance} />
            <span>% of Dalmia weight =</span>
            <span className="num" style={{ fontWeight: 700 }}>
              {formatQty(s.toleranceKg)} kg
            </span>
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            Shortfall {formatQty(s.shortfallTotal)} kg —{' '}
            {s.beyondTolerance ? 'beyond tolerance, weight short is charged.' : 'within tolerance, no weight-short charge.'}
            {s.toleranceTest === 'FRACTION' && ' The test used is the fixed tolerance in Settings; this row is informational.'}
          </Typography>
        </Box>
        <TextField
          label="Remarks"
          multiline
          minRows={2}
          value={draft.remarks ?? ''}
          disabled={!editable}
          onChange={(e) => onRemarks(e.target.value || null)}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      </Box>

      <Box sx={{ px: 2, pb: 2, display: 'flex', gap: 6, flexWrap: 'wrap', color: 'text.secondary', fontSize: '0.8125rem' }}>
        <span>
          Checked by: <strong>{report.checkedBy?.name ?? report.checkedByName ?? '—'}</strong>
        </span>
        <span>
          Approved by: <strong>{report.approvedBy?.name ?? report.approvedByName ?? '—'}</strong>
          {report.approvedAt && ` on ${formatDateTime(report.approvedAt)}`}
        </span>
      </Box>
    </SectionCard>
  );
}
