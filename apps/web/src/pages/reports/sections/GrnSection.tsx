import { Box, Typography } from '@mui/material';
import { SectionCard } from '../../../components/SectionCard';
import type { Draft } from '../draft';

interface Props {
  draft: Draft;
  editable: boolean;
  onChange: (value: string | null) => void;
}

/** Sheet I13. Stores raises the GRN once QC is done and hands the report to the Purchase Manager. */
export function GrnSection({ draft, editable, onChange }: Props) {
  return (
    <SectionCard label="Goods receipt" title="GRN" owner="Stores" editable={editable}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <span className="section-label">GRN No.</span>
        <input
          className="cell-input text"
          style={{ width: 280 }}
          aria-label="GRN No."
          placeholder={editable ? 'Enter the GRN number' : 'Entered by Stores after QC'}
          maxLength={60}
          disabled={!editable}
          value={draft.header.grnNumber ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
        <Typography variant="caption" color="text.secondary">
          Needed before the report reaches the Purchase Manager; the Tally narration ends with it.
        </Typography>
      </Box>
    </SectionCard>
  );
}
