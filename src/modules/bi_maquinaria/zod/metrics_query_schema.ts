import { z } from "zod";
import { ISO_WITH_OFFSET_REGEX } from "../calculations/periodos";

function optionalPositiveInt(fieldName: string) {
  return z.union([z.string(), z.number()]).optional().transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;

    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldName} debe ser un entero positivo.` });
      return z.NEVER;
    }

    return numeric;
  });
}

function positiveIntWithDefault(fieldName: string, defaultValue: number, max?: number) {
  return z.union([z.string(), z.number()]).optional().transform((value, ctx) => {
    if (value === undefined || value === "") return defaultValue;

    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldName} debe ser un entero positivo.` });
      return z.NEVER;
    }
    if (max !== undefined && numeric > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldName} debe ser menor o igual a ${max}.` });
      return z.NEVER;
    }

    return numeric;
  });
}

const booleanWithDefaultFalse = z.union([z.literal("true"), z.literal("false"), z.literal(""), z.boolean()])
  .optional()
  .transform((value) => value === true || value === "true");

const isoDateWithOffset = (fieldName: "desde" | "hasta") => z.string().refine((val) => ISO_WITH_OFFSET_REGEX.test(val), {
  message: `El parámetro '${fieldName}' debe tener una zona horaria u offset explícito (ej: 2026-08-01T00:00:00-06:00).`,
});

export const metricsQuerySchema = z.object({
  query: z.object({
    desde: isoDateWithOffset("desde"),
    hasta: isoDateWithOffset("hasta"),
    agrupacion: z.enum(["EQUIPO", "PROCESO", "AREA"]).default("EQUIPO"),
    maquinaId: optionalPositiveInt("maquinaId"),
    proceso: z.string().trim().optional(),
    area: z.string().trim().optional(),
    criticidad: z.string().trim().optional(),
    estadoMaquina: z.string().trim().optional(),
    buscar: z.string().trim().optional(),
    incluirAreaNula: booleanWithDefaultFalse,
    incluirHistoricos: booleanWithDefaultFalse,
    calidad: z.enum(["CONFIRMADOS", "CONFIRMADOS_E_INCOMPLETOS"]).default("CONFIRMADOS_E_INCOMPLETOS"),
    pagina: positiveIntWithDefault("pagina", 1),
    limite: positiveIntWithDefault("limite", 25, 100),
    ordenarPor: z.enum([
      "DISPONIBILIDAD",
      "NOMBRE",
      "CODIGO",
      "TIEMPO_REPARACION",
      "RESTAURACION",
      "FRECUENCIA",
      "MTTR",
      "MTBF",
      "CONFIABILIDAD_1D",
      "CONFIABILIDAD_7D",
      "CONFIABILIDAD_30D",
      "CONFIABILIDAD_90D",
    ]).default("DISPONIBILIDAD"),
    direccion: z.enum(["ASC", "DESC"]).default("ASC"),
    _revision: z.string().optional(),
  }).strict().refine((data) => {
    try {
      return new Date(data.desde) < new Date(data.hasta);
    } catch {
      return false;
    }
  }, {
    message: "La fecha 'desde' debe ser estrictamente menor que la fecha 'hasta'.",
  }),
});

export const machineDetailQuerySchema = z.object({
  params: z.object({
    maquinaId: optionalPositiveInt("maquinaId").refine((value): value is number => value !== undefined, {
      message: "maquinaId es obligatorio.",
    }),
  }).strict(),
  query: z.object({
    desde: isoDateWithOffset("desde"),
    hasta: isoDateWithOffset("hasta"),
    paginaEventos: positiveIntWithDefault("paginaEventos", 1),
    limiteEventos: positiveIntWithDefault("limiteEventos", 25, 100),
    incluirHistoricos: booleanWithDefaultFalse,
    _revision: z.string().optional(),
  }).strict().refine((data) => {
    try {
      return new Date(data.desde) < new Date(data.hasta);
    } catch {
      return false;
    }
  }, {
    message: "La fecha 'desde' debe ser estrictamente menor que la fecha 'hasta'.",
  }),
});
