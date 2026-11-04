import LockOutlined from '@mui/icons-material/LockOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface Props {
  label: string;
  title: string;
  /** e.g. "Gate / Weighbridge" */
  owner: string;
  editable: boolean;
  children: ReactNode;
}

/** A block of the report, in the sheet's order, showing who owns it and whether it is open for the current user. */
export function SectionCard({ label, title, owner, editable, children }: Props) {
  return (
    <Paper variant="outlined" component="section" sx={{ overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, px: 2, pt: 1.5, pb: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography className="section-label">{label}</Typography>
          <Typography variant="h4" component="h2">
            {title}
          </Typography>
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            color: editable ? 'var(--brand-primary)' : 'var(--text-secondary)',
            fontSize: '0.75rem',
          }}
        >
          {editable ? <EditOutlined sx={{ fontSize: 16 }} /> : <LockOutlined sx={{ fontSize: 16 }} />}
          <span>
            Owned by {owner} · {editable ? 'open for you' : 'read-only'}
          </span>
        </Box>
      </Box>
      <Box sx={{ borderTop: '1px solid var(--border)' }}>{children}</Box>
    </Paper>
  );
}
