import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AdminMaterialDto,
  AdminParameterDto,
  AdminSupplierDto,
  CreateSupplierInput,
  CreateUserInput,
  RateRuleInput,
  ReplaceNormsInput,
  SettingsDto,
  UpdateMaterialInput,
  UpdateParameterInput,
  UpdateSettingsInput,
  UpdateSupplierInput,
  UpdateUserInput,
  UserDto,
} from '@dalmia/types';
import { ApiRequestError, api } from './client';

/** Message for an Alert: the API's own sentence, plus the first field-level detail of a validation error. */
export function errorMessage(err: unknown, fallback = 'Could not reach the server.'): string {
  if (!(err instanceof ApiRequestError)) return fallback;
  const first = Array.isArray(err.details) ? (err.details[0] as { path?: string; message?: string } | string | undefined) : undefined;
  if (err.code === 'VALIDATION_ERROR' && first && typeof first === 'object' && first.message) {
    return first.path ? `${first.path}: ${first.message}` : first.message;
  }
  return err.message;
}

/**
 * Suppliers, materials, parameters and settings all feed GET /api/lookups, which the report page uses for the
 * live calculation — so every change here also refreshes ['lookups'].
 */
const refresh = (qc: QueryClient, key: string) =>
  Promise.all([qc.invalidateQueries({ queryKey: ['admin', key] }), qc.invalidateQueries({ queryKey: ['lookups'] })]);

// ---------------------------------------------------------------- users

export const useUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<UserDto[]>('/admin/users') });

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserInput) => api<UserDto>('/admin/users', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserInput }) => api<UserDto>(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export const resetUserPassword = (id: string, password: string): Promise<void> =>
  api<void>(`/admin/users/${id}/reset-password`, { method: 'POST', body: { password } });

// ---------------------------------------------------------------- suppliers

export const useAdminSuppliers = () =>
  useQuery({ queryKey: ['admin', 'suppliers'], queryFn: () => api<AdminSupplierDto[]>('/admin/suppliers') });

export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: null; body: CreateSupplierInput } | { id: string; body: UpdateSupplierInput }) =>
      input.id === null
        ? api<AdminSupplierDto>('/admin/suppliers', { method: 'POST', body: input.body })
        : api<AdminSupplierDto>(`/admin/suppliers/${input.id}`, { method: 'PATCH', body: input.body }),
    onSuccess: () => refresh(qc, 'suppliers'),
  });
}

// ---------------------------------------------------------------- materials

export const useAdminMaterials = () =>
  useQuery({ queryKey: ['admin', 'materials'], queryFn: () => api<AdminMaterialDto[]>('/admin/materials') });

export function useUpdateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMaterialInput }) => api<AdminMaterialDto>(`/admin/materials/${id}`, { method: 'PATCH', body }),
    onSuccess: () => refresh(qc, 'materials'),
  });
}

// ---------------------------------------------------------------- parameters

export const useAdminParameters = () =>
  useQuery({ queryKey: ['admin', 'parameters'], queryFn: () => api<AdminParameterDto[]>('/admin/parameters') });

export type ParameterChange =
  | { kind: 'fields'; id: string; body: UpdateParameterInput }
  | { kind: 'norms'; id: string; body: ReplaceNormsInput }
  | { kind: 'rate'; id: string; body: RateRuleInput }
  | { kind: 'deleteRate'; id: string; rateId: string };

export function useChangeParameter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: ParameterChange) => {
      switch (c.kind) {
        case 'fields':
          return api<AdminParameterDto>(`/admin/parameters/${c.id}`, { method: 'PATCH', body: c.body });
        case 'norms':
          return api<AdminParameterDto>(`/admin/parameters/${c.id}/norms`, { method: 'PUT', body: c.body });
        case 'rate':
          return api<AdminParameterDto>(`/admin/parameters/${c.id}/rate`, { method: 'PUT', body: c.body });
        case 'deleteRate':
          return api<AdminParameterDto>(`/admin/parameters/${c.id}/rate/${c.rateId}`, { method: 'DELETE' });
      }
    },
    onSuccess: () => refresh(qc, 'parameters'),
  });
}

// ---------------------------------------------------------------- global settings

export const useSettings = () => useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<SettingsDto>('/admin/settings') });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsInput) => api<SettingsDto>('/admin/settings', { method: 'PUT', body }),
    onSuccess: () => refresh(qc, 'settings'),
  });
}
