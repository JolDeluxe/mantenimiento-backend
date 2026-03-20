import { 
  EstadoTarea, 
  Rol, 
  Prisma 
} from "@prisma/client";
import { z } from "zod";
import { ticketFilterSchema } from "./zod";

type TicketFilterQuery = z.infer<typeof ticketFilterSchema>["query"];

// --- REGLAS DE SEGURIDAD Y PRIVILEGIOS ---

export const isAdminOrJefe = (rol: Rol): boolean => {
  const rolesAdmin: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
  return rolesAdmin.includes(rol);
};

export const isTecnico = (rol: Rol): boolean => {
  return rol === Rol.TECNICO;
};

// --- FILTROS DE BASE DE DATOS ---

export const getTicketFilters = (user: { id: number; rol: Rol }, query: TicketFilterQuery): Prisma.TareaWhereInput => {
  const { 
    q, 
    estado, 
    prioridad, 
    tipo, 
    clasificacion, 
    responsableId,
    fechaInicio, 
    fechaFin, 
    huerfanos, 
    vencidos 
  } = query;

  let where: Prisma.TareaWhereInput = {};

  if (user.rol === Rol.TECNICO) {
    where.responsables = { some: { id: user.id } };
  } else if (user.rol === Rol.CLIENTE_INTERNO) {
    where.creadorId = user.id;
  }

  if (prioridad) where.prioridad = prioridad;
  if (estado) where.estado = estado;
  if (tipo) where.tipo = tipo;
  if (clasificacion) where.clasificacion = clasificacion;

  if (responsableId) {
    where.responsables = { some: { id: responsableId } };
  }

  if (fechaInicio || fechaFin) {
    where.createdAt = {};
    if (fechaInicio) where.createdAt.gte = new Date(fechaInicio);
    if (fechaFin) {
      const endDay = new Date(fechaFin);
      endDay.setHours(23, 59, 59, 999);
      where.createdAt.lte = endDay;
    }
  }

  if (q && typeof q === 'string') {
    const isNumber = !isNaN(Number(q));
    where.AND = [
      {
        OR: [
          { titulo: { contains: q } },
          { descripcion: { contains: q } },
          { planta: { contains: q } },
          { area: { contains: q } },
          { creador: { nombre: { contains: q } } },
          ...(isNumber ? [{ id: Number(q) }] : [])
        ]
      }
    ];
  }

  if (huerfanos) {
    where.responsables = { none: {} };
    where.estado = EstadoTarea.PENDIENTE;
  }

  if (vencidos) {
    where.fechaVencimiento = { lt: new Date() };
    where.estado = { 
      in: [
        EstadoTarea.PENDIENTE, 
        EstadoTarea.ASIGNADA, 
        EstadoTarea.EN_PROGRESO, 
        EstadoTarea.EN_PAUSA
      ] 
    };
  }

  return where;
};

// --- TRANSICIONES DE ESTADO ---

export const isValidTransition = (current: EstadoTarea, next: EstadoTarea): boolean => {
  const map: Record<EstadoTarea, EstadoTarea[]> = {
    [EstadoTarea.PENDIENTE]:   [EstadoTarea.ASIGNADA, EstadoTarea.CANCELADA],
    // RESUELTO y CERRADO se agregan para soportar flujo offline y el "olvido":
    // el técnico puede completar una tarea sin haberla iniciado formalmente en la app.
    // CERRADO aplica solo para rutinas (la lógica de permisos lo valida en el controlador).
    [EstadoTarea.ASIGNADA]:    [EstadoTarea.EN_PROGRESO, EstadoTarea.PENDIENTE, EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA],
    [EstadoTarea.EN_PROGRESO]: [EstadoTarea.EN_PAUSA, EstadoTarea.RESUELTO],
    // RESUELTO desde EN_PAUSA: técnico pausó, terminó el trabajo sin internet, cierra al final del turno.
    [EstadoTarea.EN_PAUSA]:    [EstadoTarea.EN_PROGRESO, EstadoTarea.RESUELTO],
    [EstadoTarea.RESUELTO]:    [EstadoTarea.CERRADO, EstadoTarea.RECHAZADO],
    [EstadoTarea.RECHAZADO]:   [EstadoTarea.EN_PROGRESO, EstadoTarea.CANCELADA],
    [EstadoTarea.CERRADO]:     [], 
    [EstadoTarea.CANCELADA]:   [] 
  };

  return map[current]?.includes(next) || false;
};

// --- UTILIDADES DE TIEMPO ---

/**
 * Calcula los minutos transcurridos entre dos fechas.
 * Garantiza un mínimo de 1 minuto para evitar registros de 0 segundos.
 */
export const calcularMinutosEntreFechas = (inicio: Date, fin: Date): number => {
  const diffMs = fin.getTime() - inicio.getTime();
  return Math.max(1, Math.round(diffMs / 60000));
};