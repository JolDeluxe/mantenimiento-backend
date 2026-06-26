// src/modules/tickets/zod/index.ts
import { z } from "zod";
import { Prioridad, EstadoTarea, TipoTarea, ClasificacionTarea } from "@prisma/client";

const commonString = z.string().trim();

const preprocessNumberArray = (val: unknown) => {
  if (val === undefined || val === null || val === "") return undefined;
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === "string") return [Number(val)];
  return val;
};

const preprocessDate = (val: unknown) => (val === "" || val === "null" ? undefined : val);

const preprocessEmpty = (val: unknown) => (val === "" || val === "null" ? undefined : val);

const preprocessNull = (val: unknown) => (val === "" || val === "null" || val === null ? null : val);

const preprocessJsonObject = (val: unknown) => {
  if (val === null || val === undefined || val === "" || val === "null") return undefined;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return undefined; }
  }
  if (typeof val === "object") return val;
  return undefined;
};

const registroTiempoManualSchema = z.object({
  inicioManual: z.preprocess(
    preprocessEmpty,
    z.coerce.date().optional()
  ),
  finManual: z.preprocess(
    preprocessEmpty,
    z.coerce.date().optional()
  ),
  duracionManualMinutos: z.preprocess(
    (val) => (val === null || val === undefined || val === "" || val === "null" ? undefined : val),
    z.coerce
      .number()
      .int("La duración debe ser un número entero de minutos")
      .positive("La duración manual debe ser mayor a 0 minutos")
      .max(1440, "La duración manual no puede exceder las 24 horas (1440 minutos) por registro")
      .optional()
  ),
});

export const ticketFilterSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(500).default(50),
    
    estado: z.preprocess(preprocessEmpty, z.nativeEnum(EstadoTarea).optional()),
    prioridad: z.preprocess(preprocessEmpty, z.nativeEnum(Prioridad).optional()),
    tipo: z.preprocess(preprocessEmpty, z.nativeEnum(TipoTarea).optional()),
    clasificacion: z.preprocess(preprocessEmpty, z.nativeEnum(ClasificacionTarea).optional()),
    categoria: z.preprocess(preprocessEmpty, z.string().optional()),
    responsableId: z.preprocess(preprocessEmpty, z.coerce.number().optional()),
    planta: z.preprocess(preprocessEmpty, z.string().optional()),
    area: z.preprocess(preprocessEmpty, z.string().optional()),
    maquinaId: z.preprocess(preprocessEmpty, z.coerce.number().optional()),
    
    // Inyección de parámetros Macro Históricos
    year: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
    month: z.preprocess(preprocessEmpty, z.coerce.number().int().min(0).max(12).optional()),
    
    fechaInicio: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    fechaFin: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),

    vencimientoDesde: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    vencimientoHasta: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),

    finalizadoDesde: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    finalizadoHasta: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    
    huerfanos: z.preprocess((val) => val === "true", z.boolean().optional()),
    vencidos: z.preprocess((val) => val === "true", z.boolean().optional()),
    
    sort: z.preprocess(
      (val) => {
        if (typeof val === "string") {
          try { return JSON.parse(val); } catch (e) { return []; }
        }
        return val;
      },
      z.array(
        z.object({
          id: z.enum(["asc", "desc"]).optional(),
          fechaVencimiento: z.enum(["asc", "desc"]).optional(),
          createdAt: z.enum(["asc", "desc"]).optional(),
          updatedAt: z.enum(["asc", "desc"]).optional(),
          prioridad: z.enum(["asc", "desc"]).optional(),
          estado: z.enum(["asc", "desc"]).optional(),
          titulo: z.enum(["asc", "desc"]).optional(),
        }).strict()
      )
    ).default([{ createdAt: "desc" }])
  }).strict()
});

export const getTicketByIdSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }).strict()
});

export const createTicketClientSchema = z.object({
  titulo: commonString.min(3),
  categoria: commonString.min(1),
  descripcion: commonString.optional(),
  prioridad: z.nativeEnum(Prioridad).optional(),
  planta: commonString.min(1),
  area: commonString.min(1),
  clasificacion: z.nativeEnum(ClasificacionTarea).optional(),
  imagenes: z.array(z.string().url()).optional(),
  maquinaId: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
  paroProduccion: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().default(false)
  ),
  impactoProduccion: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
  // NUEVO: bandera TPM — el operario ya resolvió el fallo de forma autónoma
  esMantenimientoAutonomo: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().default(false)
  ),
}).strict();


export const createTicketAdminSchema = z.object({
  titulo: commonString.min(3),
  descripcion: commonString.optional(),
  fechaVencimiento: z.preprocess(preprocessDate, z.coerce.date().optional()), 
  tiempoEstimado: z.coerce.number().int().nonnegative().optional(),
  responsables: z.preprocess(preprocessNumberArray, z.array(z.number()).optional()),
  imagenes: z.array(z.string().url()).optional(),
  prioridad: z.nativeEnum(Prioridad).default(Prioridad.MEDIA),
  tipo: z.nativeEnum(TipoTarea).default(TipoTarea.TICKET),
  clasificacion: z.nativeEnum(ClasificacionTarea).optional(),
  planta: z.string().optional(),
  area: z.string().optional(),
  categoria: commonString.min(3, "La categoría es obligatoria"),
  maquinaId: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
  paroProduccion: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().default(false)
  ),
  impactoProduccion: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional())
}).strict();

export const updateTicketSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }).strict(),
  body: z.object({
    titulo: z.string().min(5).optional(),
    descripcion: z.string().optional(),
    prioridad: z.nativeEnum(Prioridad).optional(),
    categoria: z.string().optional(),
    planta: z.string().optional(),
    area: z.string().optional(),
    responsables: z.preprocess(preprocessNumberArray, z.array(z.number()).optional()),
    fechaVencimiento: z.preprocess(preprocessDate, z.coerce.date().optional()),
    tiempoEstimado: z.coerce.number().int().nonnegative().optional(),
    tipo: z.nativeEnum(TipoTarea).optional(),
    clasificacion: z.nativeEnum(ClasificacionTarea).optional(),  
    imagenes: z.array(z.string().url()).optional(),
    imagenesEliminadas: z.preprocess(preprocessNumberArray, z.array(z.number()).optional()),
    maquinaId: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
    paroProduccion: z.preprocess(
      (val) => val === "true" || val === true,
      z.boolean().default(false)
    ),
    impactoProduccion: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional())
  }).strict()
});

export const changeStatusSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }).strict(),
  body: z.object({
    estado: z.nativeEnum(EstadoTarea),
    nota: z.string().optional(), 
    imagenes: z.array(z.string().url()).optional(),
    registroTiempoManual: z.preprocess(preprocessJsonObject, registroTiempoManualSchema.optional()),
    fechaVencimiento: z.preprocess(
      preprocessDate,
      z.coerce.date()
        .refine((val) => {
          const toMXDateStr = (d: Date): string =>
            d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
          const hoyMX = toMXDateStr(new Date());
          const valMX = toMXDateStr(val);
          return valMX >= hoyMX;
        }, { message: "La fecha de vencimiento no puede estar en el pasado" })
        .optional()
    )
  }).strict()
});

export const createTicketBatchSchema = z.object({
  body: z.object({
    tareas: z.array(z.object({
      titulo: z.string().trim().min(3).max(255),
      descripcion: z.preprocess(
        (val) => !val || val === '' ? 'Sin descripción.' : val,
        z.string()
      ),
      planta: z.string().default('KAPPA'),
      area: z.string().min(1),
      
      // La categoría SIGUE SIENDO obligatoria.
      categoria: z.string().min(1),
      
      departamentoId: z.number().int().positive().optional(),
      
      tipo: z.nativeEnum(TipoTarea).optional().default(TipoTarea.PLANEADA),
      prioridad: z.nativeEnum(Prioridad).optional().default(Prioridad.MEDIA),
      
      // La clasificación es opcional, el controlador decide.
      clasificacion: z.nativeEnum(ClasificacionTarea).optional(),
      
      tiempoEstimado: z.coerce.number().int().nonnegative().optional().default(0),
      responsables: z.preprocess(preprocessNumberArray, z.array(z.number()).optional().default([])),
      fechaVencimiento: z.preprocess(preprocessDate, z.coerce.date().optional()),
      maquinaId: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
      paroProduccion: z.preprocess(
        (val) => val === "true" || val === true,
        z.boolean().default(false)
      ),
      impactoProduccion: z.preprocess(preprocessNull, z.coerce.number().int().positive().nullable().optional()),
    }).strict()).min(1).max(50)
  }).strict()
});

export type CreateTicketBatchInput = z.infer<typeof createTicketBatchSchema>['body'];

export type TicketFilterQuery           = z.infer<typeof ticketFilterSchema>["query"];
export type GetTicketByIdParams         = z.infer<typeof getTicketByIdSchema>["params"];
export type CreateTicketClientInput     = z.infer<typeof createTicketClientSchema>;
export type CreateTicketAdminInput      = z.infer<typeof createTicketAdminSchema>;
export type UpdateTicketParams          = z.infer<typeof updateTicketSchema>["params"];
export type UpdateTicketInput           = z.infer<typeof updateTicketSchema>["body"];
export type ChangeTicketStatusParams    = z.infer<typeof changeStatusSchema>["params"];
export type ChangeTicketStatusInput     = z.infer<typeof changeStatusSchema>["body"];
export type RegistroTiempoManualInput   = z.infer<typeof registroTiempoManualSchema>;

export const rescheduleTicketsSchema = z.object({
  body: z.object({
    ticketIds: z.array(z.number().int().positive()).min(1),
    nuevaFecha: z.string(),
    motivo: z.string().min(5, "Debes justificar la reprogramación")
  }).strict()
});