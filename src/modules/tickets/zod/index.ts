import { z } from "zod";
import { Prioridad, EstadoTarea, TipoTarea, ClasificacionTarea } from "@prisma/client";

const prioridades = Object.values(Prioridad) as [string, ...string[]];
const tiposTarea = Object.values(TipoTarea) as [string, ...string[]];
const clasificaciones = Object.values(ClasificacionTarea) as [string, ...string[]];
const estadosTarea = Object.values(EstadoTarea) as [string, ...string[]];

const clasificacionesCliente = [
  ClasificacionTarea.CORRECTIVO, 
  ClasificacionTarea.MEJORA, 
  ClasificacionTarea.INFRAESTRUCTURA
] as [string, ...string[]];

const commonString = z.string().trim();

export const ticketFilterSchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  estado: z.enum(estadosTarea).optional(),
  prioridad: z.enum(prioridades).optional(),
  tipo: z.enum(tiposTarea).optional(),
  clasificacion: z.enum(clasificaciones).optional(),
  responsableId: z.coerce.number().optional(),
  fechaInicio: z.string().datetime({ offset: true }).optional().or(z.string().date().optional()),
  fechaFin: z.string().datetime({ offset: true }).optional().or(z.string().date().optional())
});

export const createTicketClientSchema = z.object({
  titulo: commonString.min(3, "El título es requerido"),
  categoria: commonString.min(1, "La categoría es requerida"),
  descripcion: commonString.min(10, "Detalla el problema (mínimo 10 letras)"),
  prioridad: z.enum(prioridades).optional(),
  planta: commonString.min(1, "La planta es requerida"),
  area: commonString.min(1, "El área es requerida"),
  clasificacion: z.enum(clasificacionesCliente),
  imagenes: z.array(z.string().url()).optional()
});

export const createTicketAdminSchema = z.object({
  titulo: commonString.min(3, "Título requerido"),
  descripcion: commonString.min(3, "Descripción requerida"),
  fechaVencimiento: z.coerce.date().optional(), 
  responsables: z.array(z.number()).optional(),
  imagenes: z.array(z.string().url()).optional(),
  prioridad: z.enum(prioridades).default(Prioridad.MEDIA),
  tipo: z.enum(tiposTarea).default(TipoTarea.TICKET),
  clasificacion: z.enum(clasificaciones).default(ClasificacionTarea.CORRECTIVO),
  planta: z.string().optional(),
  area: z.string().optional(),
  categoria: z.string().optional()
});

export const updateTicketSchema = z.object({
  titulo: z.string().min(5).optional(),
  descripcion: z.string().min(10).optional(),
  prioridad: z.enum(prioridades).optional(),
  categoria: z.string().optional(),
  planta: z.string().optional(),
  area: z.string().optional(),
  responsables: z.array(z.number()).optional(),
  fechaVencimiento: z.coerce.date().optional(),
  tipo: z.enum(tiposTarea).optional(),
  clasificacion: z.enum(clasificaciones).optional(),  
  imagenes: z.array(z.string().url()).optional(),
  imagenesEliminadas: z.array(z.number()).optional()
});

export const changeStatusSchema = z.object({
  estado: z.enum(estadosTarea),
  nota: z.string().optional(), 
  imagenes: z.array(z.string().url()).optional()
});