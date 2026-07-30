import { Prioridad, UnidadRecurrenciaActividad } from "@prisma/client";
import { z } from "zod";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalNull = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(
  (value) => value === "" || value === "null" || value === null ? null : value,
  schema.nullable().optional(),
);
const optionalBoolean = z.preprocess((value) => {
  if (value === undefined || value === "" || value === "null") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());
const fechaSchema = z.string().regex(DATE_ONLY, "La fecha debe tener formato YYYY-MM-DD");
const horaSchema = z.string().regex(TIME_ONLY, "La hora debe tener formato HH:mm");
const emptyBodySchema = z.preprocess((value) => value ?? {}, z.object({}).strict());
const responsablesSchema = z.array(z.coerce.number().int().positive()).max(100).default([])
  .transform((ids) => [...new Set(ids)]);

const reglaBase = z.object({
  titulo: z.string().trim().min(3).max(255),
  descripcion: optionalNull(z.string().trim().max(2000)),
  categoria: z.string().trim().min(1).max(191),
  planta: optionalNull(z.string().trim().min(1).max(191)),
  area: z.string().trim().min(1).max(191),
  prioridad: z.nativeEnum(Prioridad).default(Prioridad.MEDIA),
  fechaInicio: fechaSchema,
  fechaFin: optionalNull(fechaSchema),
  horaInicio: optionalNull(horaSchema),
  horaFin: optionalNull(horaSchema),
  tiempoEstimado: optionalNull(z.coerce.number().int().positive().max(1440)),
  unidad: z.nativeEnum(UnidadRecurrenciaActividad),
  intervalo: z.coerce.number().int().positive().max(3650),
  responsables: responsablesSchema,
}).strict().superRefine((data, context) => {
  if (data.fechaFin && data.fechaFin < data.fechaInicio) {
    context.addIssue({ code: "custom", path: ["fechaFin"], message: "fechaFin no puede ser anterior a fechaInicio" });
  }
  const hasStart = data.horaInicio != null;
  const hasEnd = data.horaFin != null;
  if (hasStart !== hasEnd) {
    context.addIssue({ code: "custom", path: ["horaFin"], message: "horaInicio y horaFin deben enviarse juntos" });
  }
  if (hasStart && hasEnd && data.horaFin! <= data.horaInicio!) {
    context.addIssue({ code: "custom", path: ["horaFin"], message: "El horario debe terminar después de iniciar; no se admite cruce de medianoche" });
  }
  if (!hasStart && !data.tiempoEstimado) {
    context.addIssue({ code: "custom", path: ["tiempoEstimado"], message: "tiempoEstimado es obligatorio cuando no hay horario" });
  }
});

export const createReglaActividadSchema = z.object({ body: reglaBase, params: z.object({}).strict(), query: z.object({}).strict() }).strict();

export const updateReglaActividadSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }).strict(),
  body: z.object({
    titulo: z.string().trim().min(3).max(255).optional(),
    descripcion: optionalNull(z.string().trim().max(2000)),
    categoria: z.string().trim().min(1).max(191).optional(),
    planta: optionalNull(z.string().trim().min(1).max(191)),
    area: z.string().trim().min(1).max(191).optional(),
    prioridad: z.nativeEnum(Prioridad).optional(),
    fechaFin: optionalNull(fechaSchema),
    horaInicio: optionalNull(horaSchema),
    horaFin: optionalNull(horaSchema),
    tiempoEstimado: optionalNull(z.coerce.number().int().positive().max(1440)),
    responsables: z.array(z.coerce.number().int().positive()).max(100).transform((ids) => [...new Set(ids)]).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, {
    message: "Debe enviar al menos un campo editable",
  }),
  query: z.object({}).strict(),
}).strict();

export const reglaIdSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: emptyBodySchema, query: z.object({}).strict() }).strict();

export const listReglasActividadSchema = z.object({
  params: z.object({}).strict(),
  body: emptyBodySchema,
  query: z.object({
    q: z.string().trim().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    activo: optionalBoolean,
    incluirArchivadas: optionalBoolean.default(false),
    categoria: z.string().trim().optional(),
    planta: z.string().trim().optional(),
    area: z.string().trim().optional(),
    responsableId: z.coerce.number().int().positive().optional(),
    unidad: z.nativeEnum(UnidadRecurrenciaActividad).optional(),
  }).strict(),
}).strict();

const proyeccionesQuery = z.object({
  from: fechaSchema.optional(),
  to: fechaSchema.optional(),
  incluirInactivas: optionalBoolean.default(false),
}).strict();

export const proyeccionesActividadSchema = z.object({ params: z.object({}).strict(), body: emptyBodySchema, query: proyeccionesQuery.extend({ reglaId: z.coerce.number().int().positive().optional() }).strict() }).strict();
export const proyeccionReglaActividadSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: emptyBodySchema, query: proyeccionesQuery }).strict();

export const cambiarActivoSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: z.object({ activo: z.boolean() }).strict(), query: z.object({}).strict() }).strict();
export const confirmacionVaciaSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: emptyBodySchema, query: z.object({}).strict() }).strict();
export const eliminarReglaActividadSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: z.object({ confirmar: z.literal(true) }).strict(), query: z.object({}).strict() }).strict();
export const materializarActividadSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: z.object({ fechaCicloLogica: fechaSchema.optional(), confirmarFuturo: z.boolean().default(false) }).strict(), query: z.object({}).strict() }).strict();
export const moverOcurrenciaActividadSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: z.object({ fechaOriginal: fechaSchema, fechaNueva: fechaSchema, motivo: optionalNull(z.string().trim().max(1000)) }).strict(), query: z.object({}).strict() }).strict();
export const omitirOcurrenciaActividadSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: z.object({ fechaOriginal: fechaSchema, motivo: z.string().trim().min(3).max(1000) }).strict(), query: z.object({}).strict() }).strict();
export const quitarAjusteActividadSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }).strict(), body: z.object({ fechaOriginal: fechaSchema }).strict(), query: z.object({}).strict() }).strict();

export type CreateReglaActividadInput = z.infer<typeof createReglaActividadSchema>["body"];
export type UpdateReglaActividadInput = z.infer<typeof updateReglaActividadSchema>["body"];
