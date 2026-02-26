import { z } from "zod";
import { Estatus } from "@prisma/client";

const estatusArray = Object.values(Estatus) as [string, ...string[]];

export const listDepartamentosSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    sortBy: z.enum(["nombre", "planta", "tipo", "estado", "createdAt"]).default("nombre"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  }),
});

export const getDepartamentoByIdSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
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

// --- INFERENCIAS ---
export type ListDepartamentosQuery = z.infer<typeof listDepartamentosSchema>["query"];
export type GetDepartamentoByIdParams = z.infer<typeof getDepartamentoByIdSchema>["params"];
export type CreateDepartamentoInput = z.infer<typeof createDepartamentoSchema>["body"];
export type UpdateDepartamentoParams = z.infer<typeof updateDepartamentoSchema>["params"];
export type UpdateDepartamentoInput = z.infer<typeof updateDepartamentoSchema>["body"];
export type PatchDepartamentoParams = z.infer<typeof patchDepartamentoSchema>["params"];
export type PatchDepartamentoInput = z.infer<typeof patchDepartamentoSchema>["body"];