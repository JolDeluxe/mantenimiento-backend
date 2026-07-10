import { 
  EstadoTarea, 
  Rol, 
  Prisma,
  ClasificacionTarea,
  TipoTarea
} from "@prisma/client";
import { z } from "zod";
import { ticketFilterSchema } from "./zod";
import type { TicketWithDetails, TicketDTO } from "./types";
import { prisma } from "../../db";

type TicketFilterQuery = z.infer<typeof ticketFilterSchema>["query"];
type TicketFilterUser = { id: number; rol: Rol };
type TicketOrdenable = Pick<
  TicketDTO,
  "tipo" | "clasificacion" | "isOverdue" | "estado" | "horaInicioProgramada" | "prioridad" | "createdAt" | "maquina"
>;

export type DashboardMetricas = {
  totalFiltrado: number;
  totalResumen: number;
  totalHoy: number;
  totalManana: number;
  totalAtrasadas: number;
  totalRechazadas: number;
  equipoCount: number;
  misTareasCount: number;
};

const TIPO_OPERATIVO_WEIGHT: Record<string, number> = {
  TICKET: 1,
  PLANEADA: 2,
  EXTRAORDINARIA: 3,
};

const CLASIFICACION_OPERATIVA_WEIGHT: Record<string, number> = {
  CORRECTIVO: 1,
  PREVENTIVO: 2,
  AUTONOMO: 3,
};

const PRIORIDAD_OPERATIVA_WEIGHT: Record<string, number> = {
  CRITICA: 4,
  ALTA: 3,
  MEDIA: 2,
  BAJA: 1,
};

const ESTADO_LISTADO_WEIGHT: Partial<Record<EstadoTarea, number>> = {
  [EstadoTarea.RESUELTO]: 2,
  [EstadoTarea.CERRADO]: 3,
  [EstadoTarea.CANCELADA]: 4,
};

const CRITICIDAD_MAQUINA_WEIGHT: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
};

export const isAdminOrJefe = (rol: Rol): boolean => {
  const rolesAdmin: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
  return rolesAdmin.includes(rol);
};

export const isTecnico = (rol: Rol): boolean => {
  return rol === Rol.TECNICO;
};

export const getMXDayBounds = () => {
  const toMXDateStr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const hoyMXStr = toMXDateStr(new Date());
  const parts = hoyMXStr.split('-').map(Number);
  const [yMX, mMX, dMX] = [parts[0]!, parts[1]!, parts[2]!];
  const candidateCDT = new Date(Date.UTC(yMX, mMX - 1, dMX, 5, 0, 0, 0));
  const inicioDiaHoyMX = toMXDateStr(candidateCDT) === hoyMXStr
    ? candidateCDT
    : new Date(Date.UTC(yMX, mMX - 1, dMX, 6, 0, 0, 0));

  return {
    inicioDiaHoyMX,
    finDiaHoyMX: new Date(inicioDiaHoyMX.getTime() + 24 * 60 * 60 * 1000 - 1),
    inicioDiaMananaMX: new Date(inicioDiaHoyMX.getTime() + 24 * 60 * 60 * 1000),
    finDiaMananaMX: new Date(inicioDiaHoyMX.getTime() + 48 * 60 * 60 * 1000 - 1),
  };
};

const toMXDateForDuration = (iso: string | Date): Date => {
  const raw = typeof iso === "string" ? new Date(iso) : iso;
  const mxStr = raw.toLocaleString("en-CA", {
    timeZone: "America/Mexico_City",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  return new Date(mxStr.replace(", ", "T"));
};

export const calcularMinutosProgramadosMX = (inicio: Date, fin: Date): number | null => {
  if (fin <= inicio) return null;
  const mxInicio = toMXDateForDuration(inicio);
  const mxFin = toMXDateForDuration(fin);
  const diffMs = mxFin.getTime() - mxInicio.getTime();
  if (diffMs <= 0) return null;
  return Math.max(1, Math.floor(diffMs / 60000));
};

export const getTicketFilters = (user: { id: number; rol: Rol }, query: TicketFilterQuery): Prisma.TareaWhereInput => {
  const { 
    q, estado, prioridad, tipo, tipoIn, clasificacion, categoria, responsableId, planta, area, 
    fechaInicio, fechaFin, 
    vencimientoDesde, vencimientoHasta,
    finalizadoDesde, finalizadoHasta,
    huerfanos, vencidos,
    year, month, // Inyección de los parámetros Macro Históricos
    maquinaId,
    criticidadMaquina,
    perteneceAHoy,
    venceManana,
    scope
  } = query;

  const where: Prisma.TareaWhereInput = {};
  const andConditions: Prisma.TareaWhereInput[] = [];

  const { inicioDiaHoyMX, finDiaHoyMX, inicioDiaMananaMX, finDiaMananaMX } = getMXDayBounds();
  const hoyPeriodo = new Date();
  const inicioMesActualUTC = new Date(Date.UTC(hoyPeriodo.getUTCFullYear(), hoyPeriodo.getUTCMonth(), 1));
  const finMesActualUTC = new Date(Date.UTC(hoyPeriodo.getUTCFullYear(), hoyPeriodo.getUTCMonth() + 1, 0, 23, 59, 59, 999));

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
  else if (tipoIn?.length) where.tipo = { in: tipoIn };
  if (clasificacion) where.clasificacion = clasificacion;
  if (categoria) where.categoria = categoria;
  if (planta) where.planta = planta;
  if (area) where.area = area;
  if (maquinaId) {
    where.maquinaId = maquinaId;
  } else if (scope === "mantenimientos") {
    where.maquinaId = { not: null };
  } else if (scope === "actividades") {
    where.maquinaId = null;
  }
  if (criticidadMaquina) {
    where.maquina = { is: { criticidad: criticidadMaquina } };
  }

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
  } else if (!vencidos && !huerfanos && !perteneceAHoy && !venceManana) {
    where.estado = { not: EstadoTarea.CANCELADA };
  }

  if (responsableId) {
    andConditions.push({ responsables: { some: { id: responsableId } } });
  }

  if (huerfanos) {
    andConditions.push({ responsables: { none: {} } });
    where.estado = EstadoTarea.PENDIENTE;
  }

  if (perteneceAHoy) {
    // Excluir estados terminales: RESUELTO, CERRADO, CANCELADA
    andConditions.push({
      estado: {
        notIn: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA]
      }
    });

    // Pertenece a Hoy: vence hoy/antes, está rechazada, o es preventivo recurrente del mes actual.
    andConditions.push({
      OR: [
        {
          fechaVencimiento: {
            lte: finDiaHoyMX
          }
        },
        {
          estado: EstadoTarea.RECHAZADO
        },
        {
          reglaRecurrenciaId: { not: null },
          tipo: TipoTarea.PLANEADA,
          clasificacion: ClasificacionTarea.PREVENTIVO,
          fechaCicloLogica: {
            gte: inicioMesActualUTC,
            lte: finMesActualUTC,
          },
        }
      ]
    });
  }

  if (venceManana) {
    // Excluir estados terminales: RESUELTO, CERRADO, CANCELADA
    andConditions.push({
      estado: {
        notIn: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA]
      }
    });

    // Vence exactamente mañana
    andConditions.push({
      fechaVencimiento: {
        gte: inicioDiaMananaMX,
        lte: finDiaMananaMX
      }
    });
  }

  // Combinación inteligente de Vencidos y Rangos
  const filterVencimiento: Prisma.DateTimeFilter = {};
  let hasVencimientoFilter = false;

  if (vencidos) {
    filterVencimiento.lt = inicioDiaHoyMX;
    where.estado = { in: [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA, EstadoTarea.RECHAZADO] };
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

export const withSearchFilter = (where: Prisma.TareaWhereInput, q?: string): Prisma.TareaWhereInput => {
  const searchStr = q?.trim();
  if (!searchStr) return where;

  const searchFilter: Prisma.TareaWhereInput = {
    OR: [
      { titulo: { contains: searchStr } },
      { area: { contains: searchStr } },
      {
        maquina: {
          is: {
            OR: [
              { codigo: { contains: searchStr } },
              { nombre: { contains: searchStr } },
              { proceso: { contains: searchStr } },
              { marca: { contains: searchStr } },
              { modelo: { contains: searchStr } },
              { numeroSerie: { contains: searchStr } },
            ],
          },
        },
      },
      ...(!isNaN(Number(searchStr)) ? [{ id: Number(searchStr) }] : []),
    ],
  };

  return {
    ...where,
    AND: [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      searchFilter,
    ],
  };
};

export const limpiarFiltrosTemporales = (query: TicketFilterQuery): TicketFilterQuery => {
  const baseQuery = { ...query };
  delete baseQuery.estado;
  delete baseQuery.perteneceAHoy;
  delete baseQuery.venceManana;
  delete baseQuery.vencidos;
  delete baseQuery.vencimientoDesde;
  delete baseQuery.vencimientoHasta;
  return baseQuery;
};

const limpiarFiltroEstado = (query: TicketFilterQuery): TicketFilterQuery => {
  const baseQuery = { ...query };
  delete baseQuery.estado;
  return baseQuery;
};

const buildMetricWhere = (
  user: TicketFilterUser,
  query: TicketFilterQuery,
  overrides: Partial<TicketFilterQuery> = {}
): Prisma.TareaWhereInput => {
  const metricQuery = { ...limpiarFiltrosTemporales(query), ...overrides };
  return withSearchFilter(getTicketFilters(user, metricQuery), metricQuery.q);
};

const buildContextWhere = (
  user: TicketFilterUser,
  query: TicketFilterQuery,
  overrides: Partial<TicketFilterQuery> = {}
): Prisma.TareaWhereInput => {
  const contextQuery = { ...limpiarFiltroEstado(query), ...overrides };
  return withSearchFilter(getTicketFilters(user, contextQuery), contextQuery.q);
};

export const calcularMetricasDashboard = async (
  user: TicketFilterUser,
  querySinFiltrosTemporales: TicketFilterQuery,
  totalFiltrado: number
): Promise<DashboardMetricas> => {
  const { inicioDiaHoyMX } = getMXDayBounds();
  const contextWhere = buildContextWhere(user, querySinFiltrosTemporales);
  const badgeBaseWhere = buildMetricWhere(user, querySinFiltrosTemporales);
  const rechazadasEnTiempoWhere: Prisma.TareaWhereInput = {
    ...badgeBaseWhere,
    estado: EstadoTarea.RECHAZADO,
    OR: [
      { fechaVencimiento: null },
      { fechaVencimiento: { gte: inicioDiaHoyMX } },
    ],
  };

  const [
    totalResumen,
    totalHoy,
    totalManana,
    totalAtrasadas,
    totalRechazadas,
    misTareasCount,
  ] = await Promise.all([
    prisma.tarea.count({ where: contextWhere }),
    prisma.tarea.count({ where: buildMetricWhere(user, querySinFiltrosTemporales, { perteneceAHoy: true }) }),
    prisma.tarea.count({ where: buildMetricWhere(user, querySinFiltrosTemporales, { venceManana: true }) }),
    prisma.tarea.count({ where: buildMetricWhere(user, querySinFiltrosTemporales, { vencidos: true }) }),
    prisma.tarea.count({ where: rechazadasEnTiempoWhere }),
    prisma.tarea.count({
      where: {
        ...contextWhere,
        responsables: { some: { id: user.id } },
      },
    }),
  ]);

  return {
    totalFiltrado,
    totalResumen,
    totalHoy,
    totalManana,
    totalAtrasadas,
    totalRechazadas,
    equipoCount: totalResumen,
    misTareasCount,
  };
};

const dateMs = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

export const ordenarTicketsOperativamente = <T extends TicketOrdenable>(tickets: T[]): T[] => {
  return [...tickets].sort((a, b) => {
    // 1. Estados terminales al fondo: RESUELTO antes de CERRADO.
    const aEstadoW = ESTADO_LISTADO_WEIGHT[a.estado] ?? 1;
    const bEstadoW = ESTADO_LISTADO_WEIGHT[b.estado] ?? 1;
    if (aEstadoW !== bEstadoW) return aEstadoW - bEstadoW;

    // 2. Tipo: reportes -> planeadas -> extraordinarias
    const aTipoW = TIPO_OPERATIVO_WEIGHT[a.tipo] || 99;
    const bTipoW = TIPO_OPERATIVO_WEIGHT[b.tipo] || 99;
    if (aTipoW !== bTipoW) return aTipoW - bTipoW;

    // 3. Clasificación: correctivo -> preventivo -> autónomo
    const aClasW = CLASIFICACION_OPERATIVA_WEIGHT[a.clasificacion || ""] || 99;
    const bClasW = CLASIFICACION_OPERATIVA_WEIGHT[b.clasificacion || ""] || 99;
    if (aClasW !== bClasW) return aClasW - bClasW;

    // 4. Atrasadas primero
    const aOverdue = a.isOverdue === true;
    const bOverdue = b.isOverdue === true;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    // 5. Rechazadas vigentes primero; las vencidas ya fueron priorizadas por isOverdue
    const aRejected = a.estado === EstadoTarea.RECHAZADO;
    const bRejected = b.estado === EstadoTarea.RECHAZADO;
    if (aRejected !== bRejected) return aRejected ? -1 : 1;

    // 6. Agenda: hora programada ascendente; con hora antes que sin hora
    const aStart = dateMs(a.horaInicioProgramada);
    const bStart = dateMs(b.horaInicioProgramada);
    if (aStart !== null && bStart !== null && aStart !== bStart) return aStart - bStart;
    if ((aStart !== null) !== (bStart !== null)) return aStart !== null ? -1 : 1;

    // 7. Prioridad: crítica -> alta -> media -> baja
    const aPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[a.prioridad] || 0;
    const bPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[b.prioridad] || 0;
    if (aPriorityW !== bPriorityW) return bPriorityW - aPriorityW;

    // 8. Creación descendente
    const aCreated = dateMs(a.createdAt) || 0;
    const bCreated = dateMs(b.createdAt) || 0;
    return bCreated - aCreated;
  });
};

export const ordenarTodasHoyOperativamente = <T extends TicketOrdenable>(tickets: T[]): T[] => {
  return [...tickets].sort((a, b) => {
    // 1. Rechazadas siempre arriba: requieren corrección o retrabajo.
    const aRejected = a.estado === EstadoTarea.RECHAZADO;
    const bRejected = b.estado === EstadoTarea.RECHAZADO;
    if (aRejected !== bRejected) return aRejected ? -1 : 1;

    // 2. Atrasadas después de rechazadas.
    const aOverdue = a.isOverdue === true;
    const bOverdue = b.isOverdue === true;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    // 3. Reportes visibles antes que planeadas/extraordinarias.
    const aTicket = a.tipo === "TICKET";
    const bTicket = b.tipo === "TICKET";
    if (aTicket !== bTicket) return aTicket ? -1 : 1;

    // 4. Correctivos antes que preventivos/autónomos.
    const aClasW = CLASIFICACION_OPERATIVA_WEIGHT[a.clasificacion || ""] || 99;
    const bClasW = CLASIFICACION_OPERATIVA_WEIGHT[b.clasificacion || ""] || 99;
    if (aClasW !== bClasW) return aClasW - bClasW;

    // 5. En tareas con maquinaria, criticidad A -> B -> C.
    const aCritW = CRITICIDAD_MAQUINA_WEIGHT[a.maquina?.criticidad || ""] || 99;
    const bCritW = CRITICIDAD_MAQUINA_WEIGHT[b.maquina?.criticidad || ""] || 99;
    if (aCritW !== bCritW) return aCritW - bCritW;

    // 6. Prioridad: crítica -> alta -> media -> baja.
    const aPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[a.prioridad] || 0;
    const bPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[b.prioridad] || 0;
    if (aPriorityW !== bPriorityW) return bPriorityW - aPriorityW;

    // 7. Hora programada ascendente; con hora antes que sin hora.
    const aStart = dateMs(a.horaInicioProgramada);
    const bStart = dateMs(b.horaInicioProgramada);
    if (aStart !== null && bStart !== null && aStart !== bStart) return aStart - bStart;
    if ((aStart !== null) !== (bStart !== null)) return aStart !== null ? -1 : 1;

    // 8. Tipo restante: planeadas -> extraordinarias.
    const aTipoW = TIPO_OPERATIVO_WEIGHT[a.tipo] || 99;
    const bTipoW = TIPO_OPERATIVO_WEIGHT[b.tipo] || 99;
    if (aTipoW !== bTipoW) return aTipoW - bTipoW;

    // 9. Creación descendente.
    const aCreated = dateMs(a.createdAt) || 0;
    const bCreated = dateMs(b.createdAt) || 0;
    return bCreated - aCreated;
  });
};

export const ordenarActividadesHoyOperativamente = <T extends TicketOrdenable>(tickets: T[]): T[] => {
  return [...tickets].sort((a, b) => {
    // 1. Rechazadas siempre arriba: requieren corrección o retrabajo.
    const aRejected = a.estado === EstadoTarea.RECHAZADO;
    const bRejected = b.estado === EstadoTarea.RECHAZADO;
    if (aRejected !== bRejected) return aRejected ? -1 : 1;

    // 2. Atrasadas después de rechazadas.
    const aOverdue = a.isOverdue === true;
    const bOverdue = b.isOverdue === true;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    // 3. Reportes visibles antes que planeadas/extraordinarias.
    const aTicket = a.tipo === "TICKET";
    const bTicket = b.tipo === "TICKET";
    if (aTicket !== bTicket) return aTicket ? -1 : 1;

    // 4. Prioridad y hora programada.
    const aPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[a.prioridad] || 0;
    const bPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[b.prioridad] || 0;
    if (aPriorityW !== bPriorityW) return bPriorityW - aPriorityW;

    const aStart = dateMs(a.horaInicioProgramada);
    const bStart = dateMs(b.horaInicioProgramada);
    if (aStart !== null && bStart !== null && aStart !== bStart) return aStart - bStart;
    if ((aStart !== null) !== (bStart !== null)) return aStart !== null ? -1 : 1;

    // 5. Tipo restante: planeadas -> extraordinarias.
    const aTipoW = TIPO_OPERATIVO_WEIGHT[a.tipo] || 99;
    const bTipoW = TIPO_OPERATIVO_WEIGHT[b.tipo] || 99;
    if (aTipoW !== bTipoW) return aTipoW - bTipoW;

    // 6. Creación descendente.
    const aCreated = dateMs(a.createdAt) || 0;
    const bCreated = dateMs(b.createdAt) || 0;
    return bCreated - aCreated;
  });
};

export const ordenarMantenimientosHoyOperativamente = <T extends TicketOrdenable>(tickets: T[]): T[] => {
  return [...tickets].sort((a, b) => {
    // 1. Rechazadas siempre arriba: requieren corrección o retrabajo.
    const aRejected = a.estado === EstadoTarea.RECHAZADO;
    const bRejected = b.estado === EstadoTarea.RECHAZADO;
    if (aRejected !== bRejected) return aRejected ? -1 : 1;

    // 2. Atrasadas después de rechazadas.
    const aOverdue = a.isOverdue === true;
    const bOverdue = b.isOverdue === true;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

    // 3. Reportes primero.
    const aTicket = a.tipo === "TICKET";
    const bTicket = b.tipo === "TICKET";
    if (aTicket !== bTicket) return aTicket ? -1 : 1;

    // 4. Correctivos antes que preventivos/autónomos.
    const aClasW = CLASIFICACION_OPERATIVA_WEIGHT[a.clasificacion || ""] || 99;
    const bClasW = CLASIFICACION_OPERATIVA_WEIGHT[b.clasificacion || ""] || 99;
    if (aClasW !== bClasW) return aClasW - bClasW;

    // 5. Criticidad de maquinaria: A -> B -> C.
    const aCritW = CRITICIDAD_MAQUINA_WEIGHT[a.maquina?.criticidad || ""] || 99;
    const bCritW = CRITICIDAD_MAQUINA_WEIGHT[b.maquina?.criticidad || ""] || 99;
    if (aCritW !== bCritW) return aCritW - bCritW;

    // 6. Prioridad y hora programada.
    const aPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[a.prioridad] || 0;
    const bPriorityW = PRIORIDAD_OPERATIVA_WEIGHT[b.prioridad] || 0;
    if (aPriorityW !== bPriorityW) return bPriorityW - aPriorityW;

    const aStart = dateMs(a.horaInicioProgramada);
    const bStart = dateMs(b.horaInicioProgramada);
    if (aStart !== null && bStart !== null && aStart !== bStart) return aStart - bStart;
    if ((aStart !== null) !== (bStart !== null)) return aStart !== null ? -1 : 1;

    // 7. Tipo restante: planeadas -> extraordinarias.
    const aTipoW = TIPO_OPERATIVO_WEIGHT[a.tipo] || 99;
    const bTipoW = TIPO_OPERATIVO_WEIGHT[b.tipo] || 99;
    if (aTipoW !== bTipoW) return aTipoW - bTipoW;

    // 8. Creación descendente.
    const aCreated = dateMs(a.createdAt) || 0;
    const bCreated = dateMs(b.createdAt) || 0;
    return bCreated - aCreated;
  });
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
    const esCierreAdmin = notaString.includes('||[META:CIERRE_ADMINISTRATIVO]||');

    let cleanNota = notaString.replace(/\s*\|\|\[META:[^\]]+\]\|\|/g, '').trim();
    if (esCierreAdmin) {
      cleanNota = cleanNota ? `${cleanNota} (Cerrado manualmente por administrador)` : "(Cerrado manualmente por administrador)";
    }

    return {
      ...h,
      esTiempoManual,
      esCierreAdmin,
      nota: cleanNota
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
