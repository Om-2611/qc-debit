import { Box, Stack, Tab, Tabs } from '@mui/material';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';

const SECTIONS = [
  { to: '/settings/users', label: 'Users' },
  { to: '/settings/suppliers', label: 'Suppliers' },
  { to: '/settings/materials', label: 'Materials' },
  { to: '/settings/parameters', label: 'Parameters' },
  { to: '/settings/global', label: 'Global settings' },
  { to: '/settings/appearance', label: 'Appearance' },
] as const;

/** Admin → Settings: a tab per master table; each tab is its own route so a page can be linked and reloaded. */
export function SettingsLayout() {
  const { pathname } = useLocation();
  const current = SECTIONS.find((s) => pathname.startsWith(s.to))?.to ?? false;

  return (
    <Stack spacing={2.5}>
      <Box sx={{ borderBottom: '1px solid var(--border)' }}>
        <Tabs value={current} variant="scrollable" scrollButtons="auto" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <Tab key={s.to} value={s.to} label={s.label} component={RouterLink} to={s.to} sx={{ textTransform: 'none', fontWeight: 700 }} />
          ))}
        </Tabs>
      </Box>
      <Outlet />
    </Stack>
  );
}
