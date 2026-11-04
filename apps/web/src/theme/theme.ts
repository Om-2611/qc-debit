import { createTheme } from '@mui/material/styles';
import { OTHER_TOKENS, color } from './tokens';

const SURFACE_RADIUS = 4;
const BUTTON_RADIUS = 20;

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: color('--brand-primary'),
      dark: color('--brand-primary-dark'),
      light: color('--brand-primary-mid'),
      contrastText: '#FFFFFF',
    },
    secondary: { main: color('--brand-accent'), contrastText: color('--text-primary') },
    success: { main: color('--success') },
    warning: { main: color('--warning') },
    error: { main: color('--danger') },
    text: { primary: color('--text-primary'), secondary: color('--text-secondary') },
    background: { default: color('--bg-page'), paper: '#FFFFFF' },
    divider: color('--border'),
  },
  shape: { borderRadius: SURFACE_RADIUS },
  typography: {
    fontFamily: OTHER_TOKENS['--font-body'].value,
    h1: { fontFamily: OTHER_TOKENS['--font-heading'].value, fontWeight: 800, fontSize: '2rem' },
    h2: { fontFamily: OTHER_TOKENS['--font-heading'].value, fontWeight: 800, fontSize: '1.5rem' },
    h3: { fontFamily: OTHER_TOKENS['--font-heading'].value, fontWeight: 700, fontSize: '1.25rem' },
    h4: { fontFamily: OTHER_TOKENS['--font-heading'].value, fontWeight: 700, fontSize: '1.125rem' },
    h5: { fontFamily: OTHER_TOKENS['--font-heading'].value, fontWeight: 700, fontSize: '1rem' },
    h6: { fontFamily: OTHER_TOKENS['--font-heading'].value, fontWeight: 700, fontSize: '0.9375rem' },
    overline: { fontWeight: 600, letterSpacing: '0.08em', color: color('--text-secondary') },
    button: { fontWeight: 700, textTransform: 'none' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: BUTTON_RADIUS, paddingInline: 20 },
        outlined: { borderWidth: 2, '&:hover': { borderWidth: 2 } },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: color('--border') },
        head: { fontWeight: 700, color: color('--text-secondary'), backgroundColor: color('--bg-surface') },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&:nth-of-type(even)': { backgroundColor: color('--bg-surface') } },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
});
