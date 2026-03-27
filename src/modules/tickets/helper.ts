import { 
  EstadoTarea, 
  Rol, 
  Prisma 
} from "@prisma/client";
import { z } from "zod";
import { ticketFilterSchema } from "./zod";

type TicketFilterQuery = z.infer<typeof ticketFilterSchema>["query"];

export const isAdminOrJefe = (rol: Rol): boolean => {
  const rolesAdmin: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
  return rolesAdmin.includes(rol);
};

export const isTecnico = (rol: Rol): boolean => {
  return rol === Rol.TECNICO;
};

export const getTicketFilters = (user: { id: number; rol: Rol }, query: TicketFilterQuery): Prisma.TareaWhereInput => {
  const { 
    q, 
    estado, 
    prioridad, 
    tipo, 
    clasificacion, 
    responsableId,
    planta,
    area,
    fechaInicio, 
    fechaFin, 
    huerfanos, 
    vencidos 
  } = query;

  const where: Prisma.TareaWhereInput = {};
  const andConditions: Prisma.TareaWhereInput[] = [];

  if (user.rol === Rol.TECNICO) {
    andConditions.push({ responsables: { some: { id: user.id } } });
  } else if (user.rol === Rol.CLIENTE_INTERNO) {
    where.creadorId = user.id;
  }

  if (prioridad) where.prioridad = prioridad;
  if (estado) where.estado = estado;
  if (tipo) where.tipo = tipo;
  if (clasificacion) where.clasificacion = clasificacion;
  if (planta) where.planta = planta;
  if (area) where.area = area;

  if (responsableId) {
    andConditions.push({ responsables: { some: { id: responsableId } } });
  }

  if (huerfanos) {
    andConditions.push({ responsables: { none: {} } });
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

  if (q && typeof q === 'string') {
    const isNumber = !isNaN(Number(q));
    andConditions.push({
      OR: [
        { titulo: { contains: q } },
        { descripcion: { contains: q } },
        { planta: { contains: q } },
        { area: { contains: q } },
        { creador: { nombre: { contains: q } } },
        ...(isNumber ? [{ id: Number(q) }] : [])
      ]
    });
  }

  if (fechaInicio || fechaFin) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (fechaInicio) createdAt.gte = new Date(fechaInicio);
    if (fechaFin) {
      const endDay = new Date(fechaFin);
      endDay.setHours(23, 59, 59, 999);
      createdAt.lte = endDay;
    }
    where.createdAt = createdAt;
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  return where;
};

export const isValidTransition = (current: EstadoTarea, next: EstadoTarea): boolean => {
  const map: Record<EstadoTarea, EstadoTarea[]> = {
    [EstadoTarea.PENDIENTE]:   [EstadoTarea.ASIGNADA, EstadoTarea.CANCELADA],
    [EstadoTarea.ASIGNADA]:    [EstadoTarea.EN_PROGRESO, EstadoTarea.PENDIENTE, EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA],
    [EstadoTarea.EN_PROGRESO]: [EstadoTarea.EN_PAUSA, EstadoTarea.RESUELTO],
    [EstadoTarea.EN_PAUSA]:    [EstadoTarea.EN_PROGRESO, EstadoTarea.RESUELTO],
    [EstadoTarea.RESUELTO]:    [EstadoTarea.CERRADO, EstadoTarea.RECHAZADO],
    [EstadoTarea.RECHAZADO]:   [EstadoTarea.EN_PROGRESO, EstadoTarea.CANCELADA],
    [EstadoTarea.CERRADO]:     [], 
    [EstadoTarea.CANCELADA]:   [] 
  };
  return map[current]?.includes(next) || false;
};

export const calcularMinutosEntreFechas = (inicio: Date, fin: Date): number => {
  const diffMs = fin.getTime() - inicio.getTime();
  return Math.max(1, Math.round(diffMs / 60000));
};