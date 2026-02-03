import { z } from "zod";
import { Estatus } from "@prisma/client";

const estatusArray = Object.values(Estatus) as [string, ...string[]];

// --- SCHEMAS ---

export const createDepartamentoSchema = z.object({
  body: z.object({
    nombre: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    planta: z.string().min(1, "La planta es obligatoria"),
    tipo: z.string().min(1, "El tipo es obligatorio"),
  }),
});

export const updateDepartamentoSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    nombre: z.string().min(3).optional(),
    planta: z.string().min(1).optional(),
    tipo: z.string().min(1).optional(),
    
    estado: z.enum(estatusArray, {
      message: "Estatus inválido"
    }).optional(),
  }),
});

export const patchDepartamentoSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    estado: z.enum(estatusArray, {
      message: "El estado solo puede ser ACTIVO o INACTIVO"
    }),
  }),
});