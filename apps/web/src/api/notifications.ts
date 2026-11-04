import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationListResponse, PushConfigResponse } from '@dalmia/types';
import { api } from './client';

const KEY = ['notifications'];
/** The bell's fallback when push is off or blocked: a new hand-off shows within this long. */
const POLL_MS = 30_000;

export const useNotifications = () =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<NotificationListResponse>('/notifications'),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

export const usePushConfig = () =>
  useQuery({ queryKey: ['notifications', 'push-config'], queryFn: () => api<PushConfigResponse>('/notifications/push-config'), staleTime: Infinity });

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      api<void>(id === 'all' ? '/notifications/read-all' : `/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY, exact: true }),
  });
}
