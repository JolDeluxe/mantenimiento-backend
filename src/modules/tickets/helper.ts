import { 
  EstadoTarea, 
  Rol, 
  Prisma,
  ClasificacionTarea
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
    q, estado, prioridad, tipo, clasificacion, categoria, responsableId, planta, area, 
    fechaInicio, fechaFin, 
    vencimientoDesde, vencimientoHasta,
    finalizadoDesde, finalizadoHasta,
    huerfanos, vencidos,
    year, month // Inyección de los parámetros Macro Históricos
  } = query;

  const where: Prisma.TareaWhereInput = {};
  const andConditions: Prisma.TareaWhereInput[] = [];

  if (user.rol === Rol.TECNICO) {
    andConditions.push({ responsables: { some: { id: user.id } } });
  } else if (user.rol === Rol.CLIENTE_INTERNO) {
    where.creadorId = user.id;
  }

  if (prioridad) where.prioridad = prioridad;
  if (tipo) where.tipo = tipo;
  if (clasificacion) where.clasificacion = clasificacion;
  if (categoria) where.categoria = categoria;
  if (planta) where.planta = planta;
  if (area) where.area = area;

  // Filtro de Periodo Histórico (Año / Mes sobre la creación del ticket)
  if (year) {
    const y = Number(year);
    const m = Number(month || 0);

    if (m > 0) {
      // Rango del mes exacto: Desde el día 1 hasta el último día del mes
      const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
      const end = new Date(y, m, 0, 23, 59, 59, 999); 
      andConditions.push({ createdAt: { gte: start, lte: end } });
    } else {
      // Todo el año: Desde el 1 de Enero hasta el 31 de Diciembre
      const start = new Date(y, 0, 1, 0, 0, 0, 0);
      const end = new Date(y, 11, 31, 23, 59, 59, 999);
      andConditions.push({ createdAt: { gte: start, lte: end } });
    }
  }

  // 🔥 REGLA DE ORO PARA CANCELADAS:
  // Si te piden explícitamente "CANCELADA", la muestras. 
  // Si no te la piden, exclúyela de tajo para que no ensucie la app.
  if (estado) {
    where.estado = estado;
  } else if (!vencidos && !huerfanos) {
    where.estado = { not: EstadoTarea.CANCELADA };
  }

  if (responsableId) {
    andConditions.push({ responsables: { some: { id: responsableId } } });
  }

  if (huerfanos) {
    andConditions.push({ responsables: { none: {} } });
    where.estado = EstadoTarea.PENDIENTE;
    where.tipo = "TICKET";
  }

  // Combinación inteligente de Vencidos y Rangos
  const filterVencimiento: Prisma.DateTimeFilter = {};
  let hasVencimientoFilter = false;

  if (vencidos) {
    filterVencimiento.lt = new Date();
    where.estado = { in: [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA] };
    where.tipo = "TICKET";
    hasVencimientoFilter = true;
  }

  if (vencimientoDesde) {
    const [y = 0, m = 1, d = 1] = vencimientoDesde.split('-').map(Number);
    filterVencimiento.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
    hasVencimientoFilter = true;
  }
  if (vencimientoHasta) {
    const [y = 0, m = 1, d = 1] = vencimientoHasta.split('-').map(Number);
    filterVencimiento.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
    hasVencimientoFilter = true;
  }

  if (hasVencimientoFilter) {
    where.fechaVencimiento = filterVencimiento;
  }

  if (finalizadoDesde || finalizadoHasta) {
    const filter: Prisma.DateTimeFilter = {};
    if (finalizadoDesde) {
      const [y = 0, m = 1, d = 1] = finalizadoDesde.split('-').map(Number);
      filter.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    if (finalizadoHasta) {
      const [y = 0, m = 1, d = 1] = finalizadoHasta.split('-').map(Number);
      filter.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
    }
    where.finalizadoAt = filter;
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  return where;
};

export const isValidTransition = (current: EstadoTarea, next: EstadoTarea, clasificacion?: ClasificacionTarea): boolean => {
  if (clasificacion === ClasificacionTarea.RUTINA) {
    if (next === EstadoTarea.CERRADO && ([EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.RECHAZADO] as EstadoTarea[]).includes(current)) {
      return true;
    }
  }

  const map: Record<EstadoTarea, EstadoTarea[]> = {
    [EstadoTarea.PENDIENTE]:   [EstadoTarea.ASIGNADA, EstadoTarea.CANCELADA],
    [EstadoTarea.ASIGNADA]:    [EstadoTarea.EN_PROGRESO, EstadoTarea.PENDIENTE, EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA],
    [EstadoTarea.EN_PROGRESO]: [EstadoTarea.EN_PAUSA, EstadoTarea.RESUELTO, EstadoTarea.CANCELADA],
    [EstadoTarea.EN_PAUSA]:    [EstadoTarea.EN_PROGRESO, EstadoTarea.RESUELTO, EstadoTarea.CANCELADA],
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