import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import { Box, Button, Chip, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material';
import type { ReactElement } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, type Role } from '@dalmia/types';
import { useAuth } from '../auth/AuthContext';
import { BrandLogo } from '../components/BrandLogo';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: ReactElement;
  /** Roles that see the item; ADMIN always does. */
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: '/reports', label: 'Reports', icon: <AssignmentOutlined />, roles: ['GATE', 'RM_STORE', 'QC_ANALYST', 'STORES', 'QC_MANAGER'] },
  { to: '/approvals', label: 'Approvals', icon: <FactCheckOutlined />, roles: ['QC_MANAGER'] },
  { to: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined />, roles: [] },
  { to: '/import', label: 'Import', icon: <UploadFileOutlined />, roles: [] },
  { to: '/settings', label: 'Settings', icon: <SettingsOutlined />, roles: [] },
];

const SIDEBAR_WIDTH = 216;

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Drop the "return to" location on an explicit sign-out, so the next person to sign in on this
  // machine lands on their own home page, not the previous user's screen.
  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true, state: null });
  };
  if (!user) return null;
  const items = NAV.filter((n) => user.role === 'ADMIN' || n.roles.includes(user.role));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 4, background: 'var(--brand-gradient)', flexShrink: 0 }} />
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2.5,
          height: 60,
          flexShrink: 0,
          bgcolor: '#fff',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <BrandLogo height={26} />
        <Box sx={{ width: '1px', height: 28, bgcolor: 'var(--border)' }} />
        <Typography variant="h6" component="div" sx={{ color: 'var(--brand-primary)' }}>
          QC Debit Notes
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {user.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {user.email}
          </Typography>
        </Box>
        <NotificationBell userId={user.id} />
        <Chip
          label={ROLE_LABELS[user.role]}
          size="small"
          sx={{ bgcolor: 'var(--brand-primary-light)', color: 'var(--brand-primary)' }}
        />
        <Button size="small" variant="outlined" startIcon={<LogoutOutlined />} onClick={() => void signOut()}>
          Sign out
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box
          component="nav"
          aria-label="Main"
          sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, borderRight: '1px solid var(--border)', bgcolor: '#fff', py: 1 }}
        >
          <List disablePadding>
            {items.map((item) => (
              <ListItemButton
                key={item.to}
                component={NavLink}
                to={item.to}
                sx={{
                  mx: 1,
                  my: 0.25,
                  borderRadius: 'var(--radius-surface)',
                  color: 'var(--text-secondary)',
                  '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 36 },
                  '&.active': {
                    bgcolor: 'var(--brand-primary-light)',
                    color: 'var(--brand-primary)',
                    '& .MuiListItemText-primary': { fontWeight: 700 },
                  },
                }}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
        <Box component="main" sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
