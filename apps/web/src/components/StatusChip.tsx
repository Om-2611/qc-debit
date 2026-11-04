import { Chip } from '@mui/material';
import { STATUS_LABELS, type ReportStatus } from '@dalmia/types';

const STYLE: Record<ReportStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: '#EEEEEE', fg: 'var(--text-secondary)' },
  INVOICE_ENTERED: { bg: 'var(--brand-primary-light)', fg: 'var(--brand-primary)' },
  WEIGHTS_ENTERED: { bg: 'var(--brand-primary-light)', fg: 'var(--brand-primary)' },
  QC_ENTERED: { bg: 'var(--brand-primary-light)', fg: 'var(--brand-primary)' },
  PENDING_APPROVAL: { bg: '#FFF3D6', fg: '#7A5200' }, // warning tint; dark text for contrast
  APPROVED: { bg: '#E3F1E4', fg: 'var(--success)' },
};

export function StatusChip({ status, sentBack }: { status: ReportStatus; sentBack?: boolean }) {
  const s = sentBack ? STYLE.PENDING_APPROVAL : STYLE[status];
  return <Chip size="small" label={sentBack ? 'Sent back' : STATUS_LABELS[status]} sx={{ bgcolor: s.bg, color: s.fg }} />;
}
