import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_HOME, loginSchema, type LoginInput } from '@dalmia/types';
import { ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BrandLogo } from '../components/BrandLogo';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  if (!loading && user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const signedIn = await login(values);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : ROLE_HOME[signedIn.role], { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach the server. Please try again.');
    }
  });

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, minHeight: '100%' }}>
      {/* Brand half — the only place besides the header strip where the gradient is used */}
      <Box
        sx={{
          background: 'var(--brand-gradient)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 4,
          p: { xs: 4, md: 8 },
        }}
      >
        {/* The logo is dark-on-transparent, so it sits on a white plate rather than on the gradient. */}
        <Paper sx={{ alignSelf: 'flex-start', px: 3, py: 2, borderRadius: 'var(--radius-surface)', overflow: 'hidden' }}>
          <BrandLogo height={44} />
        </Paper>
        <Box>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.08em', opacity: 0.9 }}>
            QUALITY CONTROL
          </Typography>
          <Typography variant="h1" sx={{ fontSize: { xs: '1.75rem', md: '2.5rem' }, mt: 1 }}>
            QC Debit Note Management
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 3, md: 8 } }}>
        <Box component="form" onSubmit={onSubmit} noValidate sx={{ width: '100%', maxWidth: 380 }}>
          <Typography className="section-label">Sign in</Typography>
          <Typography variant="h2" sx={{ mb: 3 }}>
            Welcome back
          </Typography>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              fullWidth
              size="medium"
              error={!!errors.email}
              helperText={errors.email?.message}
              {...register('email')}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              fullWidth
              size="medium"
              error={!!errors.password}
              helperText={errors.password?.message}
              {...register('password')}
            />
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <Typography variant="body2" color="text.secondary">
              Forgotten your password? Ask an administrator to reset it.
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
