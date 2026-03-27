import { z } from "zod";
import { Prioridad, EstadoTarea, TipoTarea, ClasificacionTarea } from "@prisma/client";

const clasificacionesCliente = [
  ClasificacionTarea.CORRECTIVO, 
  ClasificacionTarea.MEJORA, 
  ClasificacionTarea.INFRAESTRUCTURA
] as [string, ...string[]];

const commonString = z.string().trim();

const preprocessNumberArray = (val: unknown) => {
  if (val === undefined || val === null || val === "") return undefined;
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === "string") return [Number(val)];
  return val;
};

const preprocessDate = (val: unknown) => (val === "" || val === "null" ? undefined : val);

const preprocessEmpty = (val: unknown) => (val === "" || val === "null" ? undefined : val);

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
    z.string().datetime({ 
      offset: true, 
      message: "La fecha de inicio debe tener formato ISO 8601 con zona horaria (ej: 2026-03-19T08:00:00-06:00)" 
    }).optional()
  ),
  finManual: z.preprocess(
    preprocessEmpty,
    z.string().datetime({ 
      offset: true, 
      message: "La fecha de fin debe tener formato ISO 8601 con zona horaria (ej: 2026-03-19T10:30:00-06:00)" 
    }).optional()
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
}).superRefine((data, ctx) => {
  const tieneInicio  = !!data.inicioManual;
  const tieneFin     = !!data.finManual;
  const tieneFechas  = tieneInicio && tieneFin;
  const tieneDuracion = !!data.duracionManualMinutos;

  if (tieneInicio && !tieneFin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Requiere fecha fin", path: ["finManual"] });
    return;
  }
  if (!tieneInicio && tieneFin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Requiere fecha inicio", path: ["inicioManual"] });
    return;
  }
  if (!tieneFechas && !tieneDuracion) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Requiere duración o ambas fechas" });
    return;
  }
  if (tieneFechas && tieneDuracion) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Usa solo duración o fechas, no ambos" });
    return;
  }

  if (tieneFechas) {
    const inicio = new Date(data.inicioManual!);
    const fin    = new Date(data.finManual!);
    if (fin <= inicio) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fin no puede ser anterior a inicio", path: ["finManual"] });
      return;
    }
  }
});

export const ticketFilterSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(500).default(100),
    
    estado: z.preprocess(preprocessEmpty, z.nativeEnum(EstadoTarea).optional()),
    prioridad: z.preprocess(preprocessEmpty, z.nativeEnum(Prioridad).optional()),
    tipo: z.preprocess(preprocessEmpty, z.nativeEnum(TipoTarea).optional()),
    clasificacion: z.preprocess(preprocessEmpty, z.nativeEnum(ClasificacionTarea).optional()),
    responsableId: z.preprocess(preprocessEmpty, z.coerce.number().optional()),
    planta: z.preprocess(preprocessEmpty, z.string().optional()),
    area: z.preprocess(preprocessEmpty, z.string().optional()),
    
    fechaInicio: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    fechaFin: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    
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
          createdAt: z.enum(["asc", "desc"]).optional(),
          updatedAt: z.enum(["asc", "desc"]).optional(),
          prioridad: z.enum(["asc", "desc"]).optional(),
          estado: z.enum(["asc", "desc"]).optional(),
          titulo: z.enum(["asc", "desc"]).optional(),
        }).strict()
      )
    ).default([{ createdAt: "desc" }])
  })
});

export const getTicketByIdSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() })
});

export const createTicketClientSchema = z.object({
  titulo: commonString.min(3),
  categoria: commonString.min(1),
  descripcion: commonString.min(10),
  prioridad: z.nativeEnum(Prioridad).optional(),
  planta: commonString.min(1),
  area: commonString.min(1),
  clasificacion: z.enum(clasificacionesCliente),
  imagenes: z.array(z.string().url()).optional()
});

export const createTicketAdminSchema = z.object({
  titulo: commonString.min(3),
  descripcion: commonString.min(3),
  fechaVencimiento: z.preprocess(preprocessDate, z.coerce.date().optional()), 
  tiempoEstimado: z.coerce.number().int().nonnegative().optional(),
  responsables: z.preprocess(preprocessNumberArray, z.array(z.number()).optional()),
  imagenes: z.array(z.string().url()).optional(),
  prioridad: z.nativeEnum(Prioridad).default(Prioridad.MEDIA),
  tipo: z.nativeEnum(TipoTarea).default(TipoTarea.TICKET),
  clasificacion: z.nativeEnum(ClasificacionTarea).default(ClasificacionTarea.CORRECTIVO),
  planta: z.string().optional(),
  area: z.string().optional(),
  categoria: z.string().optional()
});

export const updateTicketSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({
    titulo: z.string().min(5).optional(),
    descripcion: z.string().min(10).optional(),
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
    imagenesEliminadas: z.preprocess(preprocessNumberArray, z.array(z.number()).optional())
  })
});

export const changeStatusSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({
    estado: z.nativeEnum(EstadoTarea),
    nota: z.string().optional(), 
    imagenes: z.array(z.string().url()).optional(),
    registroTiempoManual: z.preprocess(preprocessJsonObject, registroTiempoManualSchema.optional())
  })
});

export type TicketFilterQuery           = z.infer<typeof ticketFilterSchema>["query"];
export type GetTicketByIdParams         = z.infer<typeof getTicketByIdSchema>["params"];
export type CreateTicketClientInput     = z.infer<typeof createTicketClientSchema>;
export type CreateTicketAdminInput      = z.infer<typeof createTicketAdminSchema>;
export type UpdateTicketParams          = z.infer<typeof updateTicketSchema>["params"];
export type UpdateTicketInput           = z.infer<typeof updateTicketSchema>["body"];
export type ChangeTicketStatusParams    = z.infer<typeof changeStatusSchema>["params"];
export type ChangeTicketStatusInput     = z.infer<typeof changeStatusSchema>["body"];
export type RegistroTiempoManualInput   = z.infer<typeof registroTiempoManualSchema>;