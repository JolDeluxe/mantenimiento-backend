import { z } from "zod";
import { Estatus } from "@prisma/client";

const estatusArray = Object.values(Estatus) as [string, ...string[]];

// --- SCHEMAS ---

// Esquema para validación de filtros y paginación
export const listDepartamentosSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
  }),
});

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
    estado: z.enum(estatusArray).optional(),
  }),
});

export const patchDepartamentoSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    estado: z.enum(estatusArray),
  }),
});