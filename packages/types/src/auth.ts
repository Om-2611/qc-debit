import { z } from 'zod';
import { ROLES } from './roles';
import type { Role } from './roles';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Minimum 8 chars with a letter and a digit. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a digit');

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  password: passwordSchema,
  /** Defaults by role when omitted: off for QC_ANALYST and RM_STORE, on for the others. */
  canSeeRates: z.boolean().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(ROLES),
    isActive: z.boolean(),
    canSeeRates: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** false = rates and rupee figures are stripped from everything this user receives. ADMIN always sees them. */
  canSeeRates: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface UserDto extends AuthUser {
  isActive: boolean;
  createdAt: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
