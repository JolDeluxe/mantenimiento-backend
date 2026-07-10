// src/modules/recurrencias/zod/index.ts
import { z } from "zod";
import { FrecuenciaRecurrencia, Prioridad } from "@prisma/client";

const preprocessEmpty = (val: unknown) => (val === "" || val === "null" ? undefined : val);
const preprocessNull  = (val: unknown) => (val === "" || val === "null" || val === null ? null : val);
const preprocessBoolean = (val: unknown) => {
  if (val === "" || val === "null" || val === "undefined" || val === undefined) return undefined;
  if (val === true || val === "true") return true;
  if (val === false || val === "false") return false;
  return val;
};

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
export const createReglaSchema = z.object({
  body: z
    .object({
      maquinaId:            z.coerce.number().int().positive("maquinaId es obligatorio"),
      titulo:               z.string().trim().min(3, "El título debe tener al menos 3 caracteres").max(255),
      descripcion:          z.preprocess(preprocessNull, z.string().nullable().optional()),
      categoria:            z.string().trim().default("MAQUINARIA"),
      prioridad:            z.nativeEnum(Prioridad).default(Prioridad.MEDIA),
      tiempoEstimado:       z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
      frecuencia:           z.nativeEnum(FrecuenciaRecurrencia, { message: "frecuencia es obligatoria y debe ser un valor válido" }),
      intervaloDias:        z.preprocess(preprocessNull, z.coerce.number().int().positive("intervaloDias debe ser mayor a 0").nullable().optional()),
      tecnicoResponsableId: z.coerce.number().int().positive("tecnicoResponsableId es obligatorio"),
      proximaFechaEjecucion: z.coerce.date({ message: "proximaFechaEjecucion es obligatoria y debe ser una fecha válida" }),
      activo:               z.boolean().default(true),
    })
    .refine(
      (d) =>
        d.frecuencia !== FrecuenciaRecurrencia.PERSONALIZADA_DIAS ||
        (d.intervaloDias != null && d.intervaloDias > 0),
      {
        message: "intervaloDias es obligatorio y debe ser mayor a 0 cuando la frecuencia es PERSONALIZADA_DIAS",
        path: ["intervaloDias"],
      }
    ),
});

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------
export const updateReglaSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z
    .object({
      titulo:               z.preprocess(preprocessEmpty, z.string().trim().min(3).max(255).optional()),
      descripcion:          z.preprocess(preprocessNull, z.string().nullable().optional()),
      categoria:            z.preprocess(preprocessEmpty, z.string().trim().optional()),
      prioridad:            z.preprocess(preprocessEmpty, z.nativeEnum(Prioridad).optional()),
      tiempoEstimado:       z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
      frecuencia:           z.preprocess(preprocessEmpty, z.nativeEnum(FrecuenciaRecurrencia).optional()),
      intervaloDias:        z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
      tecnicoResponsableId: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
      proximaFechaEjecucion: z.preprocess(preprocessNull, z.coerce.date().nullable().optional()),
      activo:               z.preprocess(preprocessEmpty, z.boolean().optional()),
    })
    .refine(
      (d) => {
        if (d.frecuencia !== FrecuenciaRecurrencia.PERSONALIZADA_DIAS) return true;
        // Si se está cambiando a PERSONALIZADA_DIAS, intervaloDias debe estar presente
        return d.intervaloDias != null && d.intervaloDias > 0;
      },
      {
        message: "intervaloDias es obligatorio y debe ser > 0 cuando frecuencia es PERSONALIZADA_DIAS",
        path: ["intervaloDias"],
      }
    ),
});

// ---------------------------------------------------------------------------
// PARAMS SIMPLES
// ---------------------------------------------------------------------------
export const reglaIdSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const maquinaIdSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

// ---------------------------------------------------------------------------
// LISTADO GLOBAL
// ---------------------------------------------------------------------------
export const recurrenciasListQuerySchema = z.object({
  query: z.object({
    activo: z.preprocess(preprocessBoolean, z.boolean().optional()),
    q: z.preprocess(preprocessEmpty, z.string().trim().optional()),
    maquinaId: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
    tecnicoId: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
    incluirBaja: z.preprocess(preprocessBoolean, z.boolean().optional().default(false)),
    page: z.preprocess(preprocessEmpty, z.coerce.number().int().min(1).default(1)),
    limit: z.preprocess(preprocessEmpty, z.coerce.number().int().min(1).max(100).default(20)),
  }),
});

// ---------------------------------------------------------------------------
// PROYECCIONES
// ---------------------------------------------------------------------------
export const proyeccionesQuerySchema = z.object({
  query: z.object({
    year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  }),
});

export const proyeccionReglaQuerySchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({
    year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  }),
});

export const matrizQuerySchema = z.object({
  query: z.object({
    year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
    incluirBaja: z.preprocess(preprocessBoolean, z.boolean().optional().default(false)),
  }),
});

// ---------------------------------------------------------------------------
// MATERIALIZE
// ---------------------------------------------------------------------------
export const materializeSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({
    /** La fecha lógica del ciclo a materializar. Si se omite, se usa proximaFechaEjecucion de la regla. */
    fechaCicloLogica: z.preprocess(preprocessNull, z.coerce.date().nullable().optional()),
    /** Primera versión: futuros bloqueados salvo confirmación explícita. */
    confirmarFuturo: z.preprocess(preprocessBoolean, z.boolean().optional().default(false)),
  }),
});

// ---------------------------------------------------------------------------
// TIPOS EXPORTADOS
// ---------------------------------------------------------------------------
export type CreateReglaInput = z.infer<typeof createReglaSchema>["body"];
export type UpdateReglaInput = z.infer<typeof updateReglaSchema>["body"];
export type RecurrenciasListQuery = z.infer<typeof recurrenciasListQuerySchema>["query"];
export type ProyeccionesQuery = z.infer<typeof proyeccionesQuerySchema>["query"];
export type MatrizQuery = z.infer<typeof matrizQuerySchema>["query"];
export type MaterializeInput  = z.infer<typeof materializeSchema>["body"];
