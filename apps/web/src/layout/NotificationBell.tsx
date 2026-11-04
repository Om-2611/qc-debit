import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import {
  Alert,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationDto } from '@dalmia/types';
import { useMarkRead, useNotifications, usePushConfig } from '../api/notifications';
import { formatDateTime } from '../lib/format';
import { devicePushState, enablePush, isIosBrowserTab, relinkPush, type DevicePushState } from '../lib/push';

/** Header bell: hand-offs waiting for this user, plus the one-time "notify me on this device" switch. */
export function NotificationBell({ userId }: { userId: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const unread = data?.unreadCount ?? 0;

  // Re-link this browser to whoever just signed in (no prompt: only if permission was already given).
  useEffect(() => {
    void relinkPush().catch(() => undefined);
  }, [userId]);

  // Messages from the service worker: a push arrived (refresh the bell) or a notification was clicked (open it).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent<{ type?: string; url?: string }>) => {
      if (event.data?.type === 'notification') void queryClient.invalidateQueries({ queryKey: ['notifications'], exact: true });
      if (event.data?.type === 'navigate' && event.data.url) navigate(event.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate, queryClient]);

  const open = (n: NotificationDto) => {
    if (!n.read) markRead.mutate(n.id);
    setAnchor(null);
    navigate(n.url);
  };

  return (
    <>
      <Tooltip title={unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}>
        <IconButton aria-label={`Notifications, ${unread} unread`} onClick={(e) => setAnchor(e.currentTarget)}>
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsNoneOutlined />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.25 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            Notifications
          </Typography>
          <Button size="small" disabled={unread === 0 || markRead.isPending} onClick={() => markRead.mutate('all')}>
            Mark all read
          </Button>
        </Box>
        <Divider />
        <PushSwitch />
        {isLoading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : !data?.items.length ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 4, textAlign: 'center' }}>
            Nothing yet. You will be told here when a report reaches your desk.
          </Typography>
        ) : (
          <List disablePadding sx={{ maxHeight: 420, overflow: 'auto' }}>
            {data.items.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={() => open(n)}
                sx={{
                  display: 'block',
                  px: 2,
                  py: 1.25,
                  borderBottom: '1px solid var(--border)',
                  bgcolor: n.read ? 'transparent' : 'var(--brand-primary-light)',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: n.read ? 400 : 700 }}>
                  {n.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {n.body}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(n.createdAt)}
                </Typography>
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}

/** The one-time per-device opt-in. Hidden once enabled, or when the server has push turned off. */
function PushSwitch() {
  const { data: config } = usePushConfig();
  const [state, setState] = useState<DevicePushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void devicePushState().then(setState, () => setState('unsupported'));
  }, []);

  if (!config?.enabled || state === null || state === 'on') return null;

  if (state === 'unsupported' || state === 'insecure') {
    const why = isIosBrowserTab()
      ? 'On iPhone/iPad, add this site to the Home Screen (Share → Add to Home Screen) and open it from there to get notifications.'
      : state === 'insecure'
        ? 'Notifications need the secure (https) address of this site.'
        : 'This browser cannot show notifications; the bell still lists everything.';
    return (
      <Alert severity="info" sx={{ m: 1.5 }}>
        {why}
      </Alert>
    );
  }
  if (state === 'denied') {
    return (
      <Alert severity="warning" sx={{ m: 1.5 }}>
        Notifications are blocked for this site. Allow them from the padlock icon in the address bar, then reload.
      </Alert>
    );
  }

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await enablePush(config.publicKey!);
      setState(result === 'granted' ? 'on' : result);
    } catch {
      setError('Could not turn on notifications on this device. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Alert
      severity="info"
      sx={{ m: 1.5, alignItems: 'center' }}
      action={
        // Registering with the browser's push service can take several seconds the first time.
        <Button size="small" variant="contained" disabled={busy} onClick={() => void enable()} sx={{ whiteSpace: 'nowrap' }}>
          {busy ? 'Turning on…' : 'Turn on'}
        </Button>
      }
    >
      {error ?? 'Get a notification on this device when a report reaches your desk, even with this tab closed.'}
    </Alert>
  );
}
