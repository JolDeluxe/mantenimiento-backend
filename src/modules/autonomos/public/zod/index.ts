import { z } from "zod";

export const gatewayQuerySchema = z.object({
  query: z.object({
    codigo: z.string()
      .trim()
      .toUpperCase()
      .min(1, "El código de máquina es requerido")
      .max(50, "El código debe tener como máximo 50 caracteres")
      .regex(/^[A-Z0-9_-]+$/, "El código tiene caracteres no permitidos")
  })
});
