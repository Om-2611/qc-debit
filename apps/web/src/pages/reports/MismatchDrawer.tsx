import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { Box, Button, Chip, Divider, Drawer, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import type { MismatchRow, ReportDto } from '@dalmia/types';
import { formatAmount, formatINR } from '../../lib/format';

const differs = (a: number, b: number): boolean => Math.abs(a - b) > 0.005;

/** Warning-coloured chip for an imported report whose sheet total differs from the engine's; opens the detail drawer. */
export function MismatchChip({ report }: { report: ReportDto }) {
  const [open, setOpen] = useState(false);
  if (!report.hasMismatch) return null;
  return (
    <>
      <Chip
        size="small"
        icon={<WarningAmberOutlined sx={{ fontSize: 16, color: '#7A5200 !important' }} />}
        label="Mismatch vs. Excel"
        onClick={() => setOpen(true)}
        sx={{ bgcolor: '#FFF3D6', color: '#7A5200', border: '1px solid var(--warning)' }} // warning tint; dark text for contrast
      />
      <MismatchDrawer report={report} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

interface Props {
  report: ReportDto;
  open: boolean;
  onClose: () => void;
}

/** Row-by-row comparison of the imported sheet's own amounts with what the app's engine calculates from the same inputs. */
export function MismatchDrawer({ report, open, onClose }: Props) {
  const rows: MismatchRow[] = report.mismatchDetail ?? [];
  const total = rows.find((r) => r.kind === 'TOTAL');
  const lines = rows.filter((r) => r.kind !== 'TOTAL');

  // Differences are picked out in the danger colour, except on the (white-on-brand) total row.
  const cells = (r: MismatchRow, mark = true) => (
    <>
      <td className="num">{formatAmount(r.sheetStandardAmount)}</td>
      <td className={`num${mark && differs(r.sheetStandardAmount, r.engineStandardAmount) ? ' over-norm' : ''}`}>{formatAmount(r.engineStandardAmount)}</td>
      <td className="num">{formatAmount(r.sheetApprovedAmount)}</td>
      <td className={`num${mark && differs(r.sheetApprovedAmount, r.engineApprovedAmount) ? ' over-norm' : ''}`}>{formatAmount(r.engineApprovedAmount)}</td>
      <td className="num">{formatAmount(r.engineApprovedAmount - r.sheetApprovedAmount)}</td>
    </>
  );

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 680 }, maxWidth: '100vw', boxSizing: 'border-box', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
        <Box>
          <Typography className="section-label">Mismatch vs. Excel</Typography>
          <Typography variant="h3">{report.reportNo}</Typography>
          <Typography color="text.secondary">
            The sheet’s approved total is {formatINR(total?.sheetApprovedAmount ?? report.output.grandTotal.approvedAmount)}; the app calculates{' '}
            {formatINR(total?.engineApprovedAmount ?? report.recomputedTotal)} from the same inputs.
          </Typography>
        </Box>

        <Box sx={{ overflow: 'auto', flex: 1 }}>
          <table className="sheet">
            <thead>
              <tr>
                <th>Row</th>
                <th>Sheet standard ₹</th>
                <th>App standard ₹</th>
                <th>Sheet approved ₹</th>
                <th>App approved ₹</th>
                <th>Difference ₹</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r) => (
                <tr key={`${r.kind}-${r.code}`}>
                  <th scope="row">{r.name}</th>
                  {cells(r)}
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 16 }} className="muted">
                    Every row agrees; only the sheet’s Total (A+B+C) differs from the sum of its rows.
                  </td>
                </tr>
              )}
              {total && (
                <tr className="total-row">
                  <th scope="row">{total.name}</th>
                  {cells(total, false)}
                </tr>
              )}
            </tbody>
          </table>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
            The report keeps the sheet’s own figures, exactly as they were approved at the time. The app’s figures are shown only to explain the
            difference — usually a row of the old sheet that has no formula (Dirty bottle, Jar-PET and the last two shortage rows have no “Approved”
            formula), a norm typed over by hand, or readings entered in the other season’s row.
          </Typography>
        </Box>

        <Divider />
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Close</Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
