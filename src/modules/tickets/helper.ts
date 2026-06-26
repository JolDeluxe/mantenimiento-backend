import { 
  EstadoTarea, 
  Rol, 
  Prisma,
  ClasificacionTarea
} from "@prisma/client";
import { z } from "zod";
import { ticketFilterSchema } from "./zod";
import type { TicketWithDetails, TicketDTO } from "./types";

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
    year, month, // Inyección de los parámetros Macro Históricos
    maquinaId
  } = query;

  const where: Prisma.TareaWhereInput = {};
  const andConditions: Prisma.TareaWhereInput[] = [];

  if (user.rol === Rol.TECNICO) {
    if (!maquinaId) {
      andConditions.push({ responsables: { some: { id: user.id } } });
    }
  } else if (user.rol === Rol.CLIENTE_INTERNO) {
    if (!maquinaId) {
      where.creadorId = user.id;
    }
  }

  if (prioridad) where.prioridad = prioridad;
  if (tipo) where.tipo = tipo;
  if (clasificacion) where.clasificacion = clasificacion;
  if (categoria) where.categoria = categoria;
  if (planta) where.planta = planta;
  if (area) where.area = area;
  if (maquinaId) where.maquinaId = maquinaId;

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

export const isValidTransition = (current: EstadoTarea, next: EstadoTarea, clasificacion?: ClasificacionTarea | null, categoria?: string | null): boolean => {
  if ((clasificacion as unknown as string) === 'RUTINA' || categoria === 'RUTINA') {
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

export const computeTicketTemporalState = (tarea: TicketWithDetails): TicketDTO => {
  const toMXDateStr = (d: Date): string =>
    d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const hoyMX = toMXDateStr(new Date());

  const ESTADOS_ENTREGADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
  const ESTADOS_ACTIVOS_VENCIBLES: EstadoTarea[] = [
    EstadoTarea.PENDIENTE,
    EstadoTarea.ASIGNADA,
    EstadoTarea.EN_PROGRESO,
    EstadoTarea.EN_PAUSA,
    EstadoTarea.RECHAZADO,
  ];

  const isLate =
    ESTADOS_ENTREGADOS.includes(tarea.estado) &&
    !!tarea.finalizadoAt &&
    !!tarea.fechaVencimiento &&
    toMXDateStr(new Date(tarea.finalizadoAt)) > toMXDateStr(new Date(tarea.fechaVencimiento));

  const isOverdue =
    ESTADOS_ACTIVOS_VENCIBLES.includes(tarea.estado) &&
    !!tarea.fechaVencimiento &&
    toMXDateStr(new Date(tarea.fechaVencimiento)) < hoyMX;

  const msPerDay = 1000 * 60 * 60 * 24;
  const startMX = new Date(toMXDateStr(new Date(tarea.createdAt)) + 'T00:00:00');
  const endMX = new Date(hoyMX + 'T00:00:00');
  const diasEnEspera = Math.max(0, Math.floor((endMX.getTime() - startMX.getTime()) / msPerDay));

  const vencMX = tarea.fechaVencimiento ? toMXDateStr(new Date(tarea.fechaVencimiento)) : null;
  const belongsToDate = !!vencMX && vencMX === hoyMX;
  const esTerminal = ([EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA] as EstadoTarea[]).includes(tarea.estado);
  const perteneceAHoy = !esTerminal && (
    belongsToDate ||
    isOverdue ||
    tarea.estado === EstadoTarea.RECHAZADO
  );

  const historialMapeado = tarea.historial.map(h => {
    const notaString = h.nota || "";
    const esTiempoManual = notaString.includes('||[META:TIEMPO_MANUAL]||');
    return {
      ...h,
      esTiempoManual,
      nota: notaString.replace(' ||[META:TIEMPO_MANUAL]||', '')
    };
  });

  return {
    ...tarea,
    historial: historialMapeado,
    isLate,
    isOverdue,
    perteneceAHoy,
    diasEnEspera
  };
};