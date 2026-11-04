import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  DashboardMonthRow,
  DashboardParameterRow,
  DashboardQuery,
  DashboardSummaryDto,
  DashboardSupplierRow,
  ExcelViewQuery,
  ExcelViewResponse,
} from '@dalmia/types';
import { api } from './client';

/** '?from=…&to=…' with blanks left out; '' when nothing is set. */
export function toQueryString(query: ExcelViewQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
  const text = params.toString();
  return text ? `?${text}` : '';
}

const useDashboard = <T>(name: string, query: ExcelViewQuery) =>
  useQuery({
    queryKey: ['dashboard', name, query],
    queryFn: () => api<T>(`/dashboard/${name}${toQueryString(query)}`),
    placeholderData: keepPreviousData,
  });

export const useDashboardSummary = (q: DashboardQuery) => useDashboard<DashboardSummaryDto>('summary', q);
export const useDashboardBySupplier = (q: DashboardQuery) => useDashboard<DashboardSupplierRow[]>('by-supplier', q);
export const useDashboardByParameter = (q: DashboardQuery) => useDashboard<DashboardParameterRow[]>('by-parameter', q);
export const useDashboardMonthly = (q: DashboardQuery) => useDashboard<DashboardMonthRow[]>('monthly', q);
export const useExcelView = (q: ExcelViewQuery) => useDashboard<ExcelViewResponse>('excel-view', q);
