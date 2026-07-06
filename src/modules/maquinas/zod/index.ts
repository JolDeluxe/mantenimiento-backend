import { z } from "zod";

const preprocessEmpty = (val: unknown) => (val === "" || val === "null" ? undefined : val);
const preprocessNull = (val: unknown) => (val === "" || val === "null" || val === null ? null : val);

// Constantes locales: los enums de BD fueron eliminados, usamos strings literales
const CRITICIDADES_VALIDAS = ["A", "B", "C"] as const;
const ESTADOS_MAQUINA_VALIDOS = ["OPERATIVA", "PARO_PRODUCCION", "EN_REPARACION", "INACTIVA", "BAJA", "BAJA_ERP"] as const;

export const createMaquinaSchema = z.object({
  body: z.object({
    codigo: z.string()
      .trim()
      .toUpperCase()
      .regex(/^MBC\d{4}$/, { message: "El código debe tener el formato MBC0000 (MBC + 4 dígitos)" }),
    nombre: z.string().trim().min(2, "El nombre es obligatorio"),
    proceso: z.string().trim().min(2, "El proceso es obligatorio"),
    descripcion: z.preprocess(preprocessNull, z.string().nullable().optional()),
    criticidad: z.preprocess(
      (val) => (val === "" || val === null || val === undefined ? "C" : val),
      z.enum(CRITICIDADES_VALIDAS).default("C")
    ),
    marca: z.preprocess(preprocessNull, z.string().nullable().optional()),
    modelo: z.preprocess(preprocessNull, z.string().nullable().optional()),
    numeroSerie: z.preprocess(preprocessNull, z.string().nullable().optional()),
    planta: z.string().trim().min(1, "La planta es obligatoria"),
    area: z.string().trim().min(1, "El área es obligatoria"),
    ubicacionDetalle: z.preprocess(preprocessNull, z.string().nullable().optional()),
    departamentoId: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
    fechaInstalacion: z.preprocess(preprocessNull, z.coerce.date().nullable().optional()),
  }),
});

export const updateMaquinaSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    nombre: z.preprocess(preprocessEmpty, z.string().trim().min(2).optional()),
    proceso: z.preprocess(preprocessEmpty, z.string().trim().min(2).optional()),
    descripcion: z.preprocess(preprocessNull, z.string().nullable().optional()),
    criticidad: z.preprocess(preprocessEmpty, z.enum(CRITICIDADES_VALIDAS).optional()),
    estado: z.preprocess(preprocessEmpty, z.enum(ESTADOS_MAQUINA_VALIDOS).optional()),
    marca: z.preprocess(preprocessNull, z.string().nullable().optional()),
    modelo: z.preprocess(preprocessNull, z.string().nullable().optional()),
    numeroSerie: z.preprocess(preprocessNull, z.string().nullable().optional()),
    planta: z.preprocess(preprocessEmpty, z.string().trim().optional()),
    area: z.preprocess(preprocessEmpty, z.string().trim().optional()),
    ubicacionDetalle: z.preprocess(preprocessNull, z.string().nullable().optional()),
    departamentoId: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
    fechaInstalacion: z.preprocess(preprocessNull, z.coerce.date().nullable().optional()),
  }),
});

export const listMaquinasSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(1000).default(20),
    estado: z.preprocess(preprocessEmpty, z.enum(ESTADOS_MAQUINA_VALIDOS).optional()),
    criticidad: z.preprocess(preprocessEmpty, z.enum(CRITICIDADES_VALIDAS).optional()),
    proceso: z.preprocess(preprocessEmpty, z.string().optional()),
    planta: z.preprocess(preprocessEmpty, z.string().optional()),
    area: z.preprocess(preprocessEmpty, z.string().optional()),
    departamentoId: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
  }),
});

export const getMaquinaByIdSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export const getMaquinaPrefillSchema = z.object({
  params: z.object({
    codigo: z.string()
      .trim()
      .toUpperCase()
      .regex(/^MBC\d{4}$/, { message: "El código debe cumplir con el formato MBC0000" }),
  }),
});

export const patchMaquinaSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    estado: z.enum(ESTADOS_MAQUINA_VALIDOS),
  }),
});

export const kpisMaquinaSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  query: z.object({
    year: z.preprocess(preprocessEmpty, z.coerce.number().int().min(2020).max(2100).optional()),
    agruparPor: z.preprocess(preprocessEmpty, z.enum(["semana", "mes"]).default("mes")),
  }),
});

export type CreateMaquinaInput = z.infer<typeof createMaquinaSchema>["body"];
export type UpdateMaquinaInput = z.infer<typeof updateMaquinaSchema>["body"];
export type ListMaquinasQuery  = z.infer<typeof listMaquinasSchema>["query"];
export type PatchMaquinaInput  = z.infer<typeof patchMaquinaSchema>["body"];
export type KpisMaquinaQuery   = z.infer<typeof kpisMaquinaSchema>["query"];
