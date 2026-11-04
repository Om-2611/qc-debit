import { Autocomplete, Box, TextField } from '@mui/material';
import type { SupplierDto } from '@dalmia/types';
import { SectionCard } from '../../../components/SectionCard';
import type { Draft, HeaderKey } from '../draft';

interface Props {
  draft: Draft;
  suppliers: SupplierDto[];
  editable: boolean;
  onChange: (patch: Partial<Draft['header']>) => void;
}

export function HeaderSection({ draft, suppliers, editable, onChange }: Props) {
  const h = draft.header;
  const supplier = suppliers.find((s) => s.id === h.supplierId) ?? null;

  const field = (key: HeaderKey, label: string, type: 'text' | 'date' = 'text') => (
    <TextField
      label={label}
      type={type}
      value={h[key] ?? ''}
      disabled={!editable}
      onChange={(e) => onChange({ [key]: e.target.value === '' ? null : e.target.value })}
      slotProps={type === 'date' ? { inputLabel: { shrink: true } } : undefined}
    />
  );

  return (
    <SectionCard label="QC Report" title="Consignment details" owner="Gate" editable={editable}>
      {/* Field order follows the sheet (rows 11–13, then the date in L9) so Tab moves the same way. */}
      <Box sx={{ display: 'grid', gap: 1.5, p: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
        <Autocomplete
          freeSolo
          autoSelect
          disabled={!editable}
          options={suppliers}
          getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
          value={supplier ?? h.partyNameRaw ?? ''}
          onChange={(_e, value) =>
            onChange(
              value && typeof value === 'object'
                ? { supplierId: value.id, partyNameRaw: value.name }
                : { supplierId: null, partyNameRaw: value || null },
            )
          }
          renderInput={(params) => <TextField {...params} label="Party name" />}
          sx={{ gridColumn: { lg: 'span 2' } }}
        />
        {field('tokenDate', 'Token Dt.', 'date')}
        {field('reportDate', 'Report date', 'date')}
        {field('poNumber', 'PO No.')}
        {field('tokenNumber', 'Token No.')}
        {field('invoiceNumber', 'Invoice No.')}
        {field('invoiceDate', 'Invoice Dt.', 'date')}
        {field('truckNumber', 'Truck No.')}
      </Box>
    </SectionCard>
  );
}
