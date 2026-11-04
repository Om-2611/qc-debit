import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportBatchDto, ImportCommitInput, ImportCommitResult, ImportPreviewDto } from '@dalmia/types';
import { api, apiUpload } from './client';

/** Parses the workbook on the server; nothing is saved until the preview is committed. */
export const previewImport = (file: File): Promise<ImportPreviewDto> => {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<ImportPreviewDto>('/admin/import/preview', form);
};

export const useImportBatches = () =>
  useQuery({ queryKey: ['import-batches'], queryFn: () => api<ImportBatchDto[]>('/admin/import/batches') });

/** Imported reports appear in the list, the dashboard and the supplier lookups, so those are refreshed too. */
const useRefreshAfterImport = () => {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [['import-batches'], ['reports'], ['lookups'], ['dashboard']].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );
};

export function useCommitImport() {
  const refresh = useRefreshAfterImport();
  return useMutation({
    mutationFn: (body: ImportCommitInput) => api<ImportCommitResult>('/admin/import/commit', { method: 'POST', body }),
    onSuccess: refresh,
  });
}

export function useUndoImport() {
  const refresh = useRefreshAfterImport();
  return useMutation({
    mutationFn: (batchId: string) => api<{ batchId: string; deletedReports: number }>(`/admin/import/batches/${batchId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}
