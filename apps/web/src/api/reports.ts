import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApprovalPatch,
  AuditEntryDto,
  CreateReportInput,
  GrnPatch,
  HeaderPatch,
  LookupsDto,
  QcPatch,
  ReportDto,
  ReportListQuery,
  ReportListResponse,
  WeightsPatch,
} from '@dalmia/types';
import { api } from './client';

export const useLookups = () =>
  useQuery({ queryKey: ['lookups'], queryFn: () => api<LookupsDto>('/lookups'), staleTime: 5 * 60_000 });

export function useReportList(query: ReportListQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
  return useQuery({
    queryKey: ['reports', query],
    queryFn: () => api<ReportListResponse>(`/reports?${params}`),
    placeholderData: keepPreviousData,
  });
}

export const useReport = (id: string) =>
  useQuery({ queryKey: ['report', id], queryFn: () => api<ReportDto>(`/reports/${id}`) });

export const useReportAudit = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ['report', id, 'audit'], queryFn: () => api<AuditEntryDto[]>(`/reports/${id}/audit`), enabled });

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReportInput) => api<ReportDto>('/reports', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

export type SectionPatch =
  | { section: 'header'; body: HeaderPatch }
  | { section: 'weights'; body: WeightsPatch }
  | { section: 'qc'; body: QcPatch }
  | { section: 'grn'; body: GrnPatch }
  | { section: 'approval'; body: ApprovalPatch };

export const patchSection = (id: string, patch: SectionPatch): Promise<ReportDto> =>
  api<ReportDto>(`/reports/${id}/${patch.section}`, { method: 'PATCH', body: patch.body });

export type WorkflowAction = 'submit-invoice' | 'submit-weights' | 'submit-qc' | 'submit-grn' | 'approve' | 'send-back' | 'reopen';

export const postAction = (id: string, action: WorkflowAction, body?: unknown): Promise<ReportDto> =>
  api<ReportDto>(`/reports/${id}/${action}`, { method: 'POST', body });
