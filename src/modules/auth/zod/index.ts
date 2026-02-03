import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    identifier: z
      .string()
      .min(1, { message: 'Debes ingresar tu correo o usuario' }),
    password: z
      .string()
      .min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }),
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

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];