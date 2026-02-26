import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    identifier: z.string().min(1, { message: 'Debes ingresar tu correo o usuario' }),
    password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    nombre: z.string().min(3, "El nombre es muy corto"),
    email: z.string()
      .email("Formato de correo inválido")
      .endsWith("@cuadra.com.mx", { message: "Solo se permiten correos corporativos" }),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    cargo: z.string().optional(),
    departamentoId: z.number().int().nullable().optional(),
    imagen: z.string().optional(),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string()
      .email({ message: "Formato de correo inválido" })
      .min(1, { message: "El correo es obligatorio" }),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, { message: "El token es obligatorio" }),
    password: z.string().min(6, { message: "La nueva contraseña debe tener al menos 6 caracteres" }),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "La contraseña actual es requerida"),
    newPassword: z.string().min(6, "La nueva contraseña debe tener al menos 6 caracteres")
  })
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "El token de refresco es requerido")
  })
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>['body'];