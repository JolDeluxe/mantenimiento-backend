import { z } from "zod";
import { Prioridad, EstadoTarea, TipoTarea, ClasificacionTarea } from "@prisma/client";

const clasificacionesCliente = [
  ClasificacionTarea.CORRECTIVO, 
  ClasificacionTarea.MEJORA, 
  ClasificacionTarea.INFRAESTRUCTURA
] as [string, ...string[]];

const commonString = z.string().trim();

// --- PREPROCESADORES DE LIMPIEZA ---
const preprocessNumberArray = (val: unknown) => {
  if (val === undefined || val === null || val === "") return undefined;
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === "string") return [Number(val)];
  return val;
};

const preprocessDate = (val: unknown) => (val === "" || val === "null" ? undefined : val);

// Transforma strings vacíos o "null" de la URL a undefined para peticiones GET
const preprocessEmpty = (val: unknown) => (val === "" || val === "null" ? undefined : val);

// --- ESQUEMAS DE VALIDACIÓN ---
export const ticketFilterSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(500).default(100),
    
    // Preprocesamos campos susceptibles a strings vacíos en la URL
    estado: z.preprocess(preprocessEmpty, z.nativeEnum(EstadoTarea).optional()),
    prioridad: z.preprocess(preprocessEmpty, z.nativeEnum(Prioridad).optional()),
    tipo: z.preprocess(preprocessEmpty, z.nativeEnum(TipoTarea).optional()),
    clasificacion: z.preprocess(preprocessEmpty, z.nativeEnum(ClasificacionTarea).optional()),
    responsableId: z.preprocess(preprocessEmpty, z.coerce.number().optional()),
    
    fechaInicio: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    fechaFin: z.preprocess(preprocessEmpty, z.string().datetime({ offset: true }).optional().or(z.string().date().optional())),
    
    // --- NUEVOS FILTROS DE DASHBOARD ---
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
  params: z.object({
    id: z.coerce.number().int().positive({ message: "ID de ticket inválido" })
  })
});

// Sin envoltura 'body' para uso manual en el Dispatcher
export const createTicketClientSchema = z.object({
  titulo: commonString.min(3, "El título es requerido"),
  categoria: commonString.min(1, "La categoría es requerida"),
  descripcion: commonString.min(10, "Detalla el problema (mínimo 10 letras)"),
  prioridad: z.nativeEnum(Prioridad).optional(),
  planta: commonString.min(1, "La planta es requerida"),
  area: commonString.min(1, "El área es requerida"),
  clasificacion: z.enum(clasificacionesCliente),
  imagenes: z.array(z.string().url()).optional()
});

export const createTicketAdminSchema = z.object({
  titulo: commonString.min(3, "Título requerido"),
  descripcion: commonString.min(3, "Descripción requerida"),
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
  params: z.object({ 
    id: z.coerce.number().int().positive() 
  }),
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
  params: z.object({ 
    id: z.coerce.number().int().positive() 
  }),
  body: z.object({
    estado: z.nativeEnum(EstadoTarea),
    nota: z.string().optional(), 
    imagenes: z.array(z.string().url()).optional()
  })
});

// --- INFERENCIAS ---
export type TicketFilterQuery = z.infer<typeof ticketFilterSchema>["query"];
export type GetTicketByIdParams = z.infer<typeof getTicketByIdSchema>["params"];
export type CreateTicketClientInput = z.infer<typeof createTicketClientSchema>;
export type CreateTicketAdminInput = z.infer<typeof createTicketAdminSchema>;
export type UpdateTicketParams = z.infer<typeof updateTicketSchema>["params"];
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>["body"];
export type ChangeTicketStatusParams = z.infer<typeof changeStatusSchema>["params"];
export type ChangeTicketStatusInput = z.infer<typeof changeStatusSchema>["body"];