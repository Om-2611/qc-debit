import { zodResolver } from '@hookform/resolvers/zod';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  Switch,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ROLES, ROLE_LABELS, createUserSchema, resetPasswordSchema, type CreateUserInput, type Role, type UserDto } from '@dalmia/types';
import { errorMessage, resetUserPassword, useCreateUser, useUpdateUser, useUsers } from '../../api/admin';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

const PASSWORD_HINT = 'At least 8 characters, with a letter and a digit.';

/** Admin → Settings → Users. The API refuses to demote or deactivate the signed-in admin or the last admin; its message is shown as is. */
export function UsersPage() {
  const { user: me } = useAuth();
  const { data, isFetching, error } = useUsers();
  const update = useUpdateUser();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserDto | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const change = async (u: UserDto, body: { role?: Role; isActive?: boolean; canSeeRates?: boolean }, done: string) => {
    setFailure(null);
    try {
      await update.mutateAsync({ id: u.id, body });
      setToast(done);
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography className="section-label">Settings · Users</Typography>
          <Typography variant="h2">Users and roles</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            A role change or deactivation applies at once and signs the user out everywhere.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
          New user
        </Button>
      </Box>

      {(error || failure) && (
        <Alert severity="error" onClose={failure ? () => setFailure(null) : undefined}>
          {failure ?? error?.message}
        </Alert>
      )}

      <Paper variant="outlined">
        <Box sx={{ height: 4 }}>{(isFetching || update.isPending) && <LinearProgress />}</Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Sees rates</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.map((u) => (
                <TableRow key={u.id} hover sx={{ opacity: u.isActive ? 1 : 0.6 }}>
                  <TableCell sx={{ fontWeight: 700 }}>
                    {u.name}
                    {u.id === me?.id && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        (you)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <TextField
                      select
                      value={u.role}
                      disabled={update.isPending}
                      onChange={(e) => {
                        const role = e.target.value as Role;
                        void change(u, { role }, `${u.name} is now ${ROLE_LABELS[role]}`);
                      }}
                      slotProps={{ htmlInput: { 'aria-label': `Role of ${u.name}` } }}
                      sx={{ minWidth: 190 }}
                    >
                      {ROLES.map((r) => (
                        <MenuItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    {/* Admins always see rates; for everyone else this strips rates and every ₹ figure server-side. */}
                    <Switch
                      size="small"
                      checked={u.role === 'ADMIN' || u.canSeeRates}
                      disabled={u.role === 'ADMIN' || update.isPending}
                      onChange={(e) => void change(u, { canSeeRates: e.target.checked }, `${u.name} ${e.target.checked ? 'can now see' : 'no longer sees'} rates and amounts`)}
                      slotProps={{ input: { 'aria-label': `${u.name} can see rates` } }}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={u.isActive ? 'Active' : 'Inactive'}
                      sx={u.isActive ? { bgcolor: '#E3F1E4', color: 'var(--success)' } : { bgcolor: '#EEEEEE', color: 'var(--text-secondary)' }}
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(u.createdAt)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => setResetting(u)}>
                      Reset password
                    </Button>
                    <Button
                      size="small"
                      color={u.isActive ? 'error' : 'primary'}
                      disabled={update.isPending}
                      onClick={() => void change(u, { isActive: !u.isActive }, `${u.name} ${u.isActive ? 'deactivated' : 'activated'}`)}
                    >
                      {u.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onDone={(name) => setToast(`${name} created`)} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onDone={(name) => setToast(`Password reset for ${name}`)} />
      <Snackbar open={toast !== null} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}

function CreateUserDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (name: string) => void }) {
  const create = useCreateUser();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', role: 'GATE', password: '' },
  });

  const close = () => {
    reset();
    setError(null);
    onClose();
  };
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const user = await create.mutateAsync(v);
      close();
      onDone(user.name);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the user.'));
    }
  });
  const e = formState.errors;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <form onSubmit={submit} noValidate>
        <DialogTitle>New user</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name" autoFocus error={!!e.name} helperText={e.name?.message} {...register('name')} />
            <TextField label="Email" type="email" autoComplete="off" error={!!e.email} helperText={e.email?.message} {...register('email')} />
            <TextField select label="Role" defaultValue="GATE" error={!!e.role} helperText={e.role?.message} {...register('role')}>
              {ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              error={!!e.password}
              helperText={e.password?.message ?? PASSWORD_HINT}
              {...register('password')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Creating…' : 'Create user'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: UserDto | null; onClose: () => void; onDone: (name: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState } = useForm<{ password: string }>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });

  const close = () => {
    reset();
    setError(null);
    onClose();
  };
  const submit = handleSubmit(async ({ password }) => {
    if (!user) return;
    setError(null);
    try {
      await resetUserPassword(user.id, password);
      close();
      onDone(user.name);
    } catch (err) {
      setError(errorMessage(err, 'Could not reset the password.'));
    }
  });

  return (
    <Dialog open={user !== null} onClose={close} fullWidth maxWidth="xs">
      <form onSubmit={submit} noValidate>
        <DialogTitle>Reset password</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Set a new password for {user?.name} ({user?.email}). They are signed out everywhere and must use the new password.
          </DialogContentText>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="New password"
              type="password"
              autoFocus
              autoComplete="new-password"
              error={!!formState.errors.password}
              helperText={formState.errors.password?.message ?? PASSWORD_HINT}
              {...register('password')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            Reset password
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
