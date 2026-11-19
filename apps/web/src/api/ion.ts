import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IonReportViewDto } from '@dalmia/types';
import { api, fetchBlobUrl } from './client';

const key = (reportId: string) => ['ion', reportId] as const;

/** The report's iON push and what still blocks it. While a job is queued or running the view refreshes by itself. */
export const useIonView = (reportId: string, enabled: boolean) =>
  useQuery({
    queryKey: key(reportId),
    queryFn: () => api<IonReportViewDto>(`/ion/reports/${reportId}`),
    enabled,
    refetchInterval: (q) => {
      const push = q.state.data?.push;
      return push && (push.active || push.status === 'QUEUED' || push.status === 'RUNNING') ? 3000 : false;
    },
  });

export interface PushInput {
  itemCodeOverride?: string | null;
  mismatchConfirmed?: boolean;
}

function useIonAction<I>(reportId: string, send: (input: I) => Promise<IonReportViewDto | { view: IonReportViewDto; warning: string | null }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (result) => {
      const view = 'view' in result ? result.view : result;
      qc.setQueryData(key(reportId), view);
      void qc.invalidateQueries({ queryKey: ['report', reportId, 'audit'] });
    },
  });
}

export const useIonPush = (reportId: string) =>
  useIonAction<PushInput>(reportId, (body) => api<IonReportViewDto>(`/ion/reports/${reportId}/push`, { method: 'POST', body }));

export const useIonRetry = (reportId: string) =>
  useIonAction<void>(reportId, () => api<IonReportViewDto>(`/ion/reports/${reportId}/retry`, { method: 'POST' }));

export const useIonContinue = (reportId: string) =>
  useIonAction<void>(reportId, () => api<IonReportViewDto>(`/ion/reports/${reportId}/continue`, { method: 'POST' }));

export const useIonReset = (reportId: string) =>
  useIonAction<{ confirm: string; note: string }>(reportId, (body) =>
    api<{ view: IonReportViewDto; warning: string | null }>(`/ion/reports/${reportId}/reset`, { method: 'POST', body }),
  );

/** A step screenshot as an object URL (an <img src> cannot send the bearer token). */
export const loadIonScreenshot = (id: string): Promise<string> => fetchBlobUrl(`/ion/screenshots/${id}`);
