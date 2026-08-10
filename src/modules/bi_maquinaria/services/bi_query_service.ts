import { prisma } from "../../../db";
import { CalidadDato, EstadoFalla, Prisma } from "@prisma/client";

export interface MaquinasQueryParams {
  agrupacion: "EQUIPO" | "PROCESO" | "AREA";
  maquinaId?: number;
  proceso?: string;
  area?: string;
  criticidad?: string;
  estadoMaquina?: string;
  buscar?: string;
  incluirAreaNula?: boolean;
  hastaEfectivo: Date;
}

export interface FailureQueryInput {
  desde: Date;
  hastaEfectivo: Date;
  calidad: "CONFIRMADOS" | "CONFIRMADOS_E_INCOMPLETOS";
  incluirHistoricos?: boolean;
}

export class BIQueryService {
  private static calidadesIncluidas(calidad: FailureQueryInput["calidad"], incluirHistoricos = false): CalidadDato[] {
    const calidades: CalidadDato[] =
      calidad === "CONFIRMADOS"
        ? [CalidadDato.CONFIRMADO]
        : [CalidadDato.CONFIRMADO, CalidadDato.DATO_INCOMPLETO];

    if (incluirHistoricos) {
      calidades.push(CalidadDato.HISTORICO_ESTIMADO);
    }
    return calidades;
  }

  private static estadosFallaIncluidos(): EstadoFalla[] {
    return [EstadoFalla.ABIERTA, EstadoFalla.REHABILITADA, EstadoFalla.CERRADA];
  }

  /**
   * Obtiene la población de máquinas aplicando filtros de búsqueda y paginación.
   * Obtiene la población actual de máquinas aplicando filtros de búsqueda.
   * El periodo afecta las métricas, no la visibilidad del catálogo.
   */
  static async obtenerMaquinas(params: MaquinasQueryParams) {
    const {
      agrupacion,
      maquinaId,
      proceso,
      area,
      criticidad,
      estadoMaquina,
      buscar,
      incluirAreaNula = false,
    } = params;

    const baseWhere: Prisma.MaquinaWhereInput = {};

    if (maquinaId) {
      baseWhere.id = maquinaId;
    }
    if (proceso) {
      baseWhere.proceso = proceso;
    }
    if (area) {
      baseWhere.area = area;
    }
    if (criticidad) {
      baseWhere.criticidad = criticidad;
    }
    if (estadoMaquina) {
      baseWhere.estado = estadoMaquina;
    }

    if (buscar) {
      baseWhere.OR = [
        { codigo: { contains: buscar } },
        { nombre: { contains: buscar } },
      ];
    }

    const where: Prisma.MaquinaWhereInput = { ...baseWhere };
    const excluirAreaNula = agrupacion === "AREA" && !incluirAreaNula && !area;
    if (excluirAreaNula) {
      where.area = { not: null };
    }

    // Contar total de registros filtrados
    const totalRegistros = await prisma.maquina.count({ where });

    // Contar cuántas máquinas quedaron excluidas por área nula en total (con los mismos filtros)
    let maquinasSinAreaExcluidas = 0;
    if (excluirAreaNula) {
      const whereExcluidas: Prisma.MaquinaWhereInput = {
        ...baseWhere,
        area: null,
      };
      maquinasSinAreaExcluidas = await prisma.maquina.count({ where: whereExcluidas });
    }

    const maquinas = await prisma.maquina.findMany({
      where,
      orderBy: { codigo: "asc" },
    });

    return {
      maquinas,
      totalMaquinasFiltradas: totalRegistros,
      maquinasSinAreaExcluidas,
    };
  }

  /**
   * Obtiene todas las fallas confirmadas que intersectan el periodo o se asocian
   * a la población de máquinas de interés.
   */
  static async obtenerFallasConfirmadas(maquinasIds: number[], input: FailureQueryInput) {
    const { desde, hastaEfectivo, calidad, incluirHistoricos = false } = input;

    if (maquinasIds.length === 0) return [];

    const calidades = BIQueryService.calidadesIncluidas(calidad, incluirHistoricos);

    // Traer fallas confirmadas del periodo para estas máquinas
    const fallas = await prisma.fallaMaquina.findMany({
      where: {
        maquinaId: { in: maquinasIds },
        contabilizaComoFalla: true,
        estado: { in: BIQueryService.estadosFallaIncluidos() },
        calidadDato: { in: calidades },
        fechaFallaConfirmada: {
          gte: desde,
          lt: hastaEfectivo,
        },
        // Permitir confirmadoPorId = null solo para HISTORICO_ESTIMADO
        OR: [
          { calidadDato: CalidadDato.HISTORICO_ESTIMADO },
          { confirmadoPorId: { not: null } },
        ],
      },
      orderBy: { fechaFallaConfirmada: "asc" },
    });

    return fallas;
  }

  static async obtenerIntervalosTecnicos(tareaIds: number[]) {
    const idsUnicos = Array.from(new Set(tareaIds.filter((id) => Number.isInteger(id))));
    if (idsUnicos.length === 0) return [];

    return prisma.intervaloTiempo.findMany({
      where: {
        tareaId: { in: idsUnicos },
      },
      select: {
        id: true,
        tareaId: true,
        inicio: true,
        fin: true,
      },
      orderBy: [
        { tareaId: "asc" },
        { inicio: "asc" },
      ],
    });
  }

  /**
   * Obtiene la falla confirmada inmediatamente anterior a "desde" para cada máquina.
   * Evita N+1 ejecutando consultas paralelas controladas en lote por paginación.
   */
  static async obtenerFallasAnteriores(
    maquinasIds: number[],
    desde: Date,
    calidad: "CONFIRMADOS" | "CONFIRMADOS_E_INCOMPLETOS",
    incluirHistoricos = false
  ) {
    if (maquinasIds.length === 0) return [];

    const calidades = BIQueryService.calidadesIncluidas(calidad, incluirHistoricos);
    const anteriores = await prisma.fallaMaquina.findMany({
      where: {
        maquinaId: { in: maquinasIds },
        contabilizaComoFalla: true,
        estado: { in: BIQueryService.estadosFallaIncluidos() },
        calidadDato: { in: calidades },
        fechaFallaConfirmada: { lt: desde },
        OR: [
          { calidadDato: CalidadDato.HISTORICO_ESTIMADO },
          { confirmadoPorId: { not: null } },
        ],
      },
      orderBy: [
        { maquinaId: "asc" },
        { fechaFallaConfirmada: "desc" },
      ],
    });

    const latestByMachine = new Map<number, (typeof anteriores)[number]>();
    for (const falla of anteriores) {
      if (!latestByMachine.has(falla.maquinaId)) {
        latestByMachine.set(falla.maquinaId, falla);
      }
    }

    return Array.from(latestByMachine.values());
  }

  /**
   * Obtiene todos los intervalos de paro que intersectan el período efectivo para las máquinas indicadas.
   */
  static async obtenerIntervalosParo(maquinasIds: number[], desde: Date, hastaEfectivo: Date) {
    if (maquinasIds.length === 0) return [];

    // Un intervalo intersecta el rango [desde, hastaEfectivo) si:
    // inicio < hastaEfectivo AND (fin IS NULL OR fin > desde)
    const paros = await prisma.intervaloParoMaquina.findMany({
      where: {
        maquinaId: { in: maquinasIds },
        inicio: { lt: hastaEfectivo },
        OR: [
          { fin: null },
          { fin: { gt: desde } },
        ],
      },
      orderBy: { inicio: "asc" },
    });

    return paros;
  }

  static async obtenerActividadesProgramacion(maquinasIds: number[], desde: Date, hastaProgramado: Date) {
    if (maquinasIds.length === 0) return [];

    const [paros, fallas, tareas] = await Promise.all([
      prisma.intervaloParoMaquina.findMany({
        where: {
          maquinaId: { in: maquinasIds },
          inicio: { lt: hastaProgramado },
          OR: [
            { fin: null },
            { fin: { gt: desde } },
          ],
        },
        select: {
          maquinaId: true,
          inicio: true,
          fin: true,
        },
      }),
      prisma.fallaMaquina.findMany({
        where: {
          maquinaId: { in: maquinasIds },
          OR: [
            { fechaFallaReportada: { gte: desde, lt: hastaProgramado } },
            { fechaFallaConfirmada: { gte: desde, lt: hastaProgramado } },
            { fechaRestauracion: { gte: desde, lt: hastaProgramado } },
          ],
        },
        select: {
          maquinaId: true,
          fechaFallaReportada: true,
          fechaFallaConfirmada: true,
          fechaRestauracion: true,
        },
      }),
      prisma.tarea.findMany({
        where: {
          maquinaId: { in: maquinasIds },
          OR: [
            { createdAt: { gte: desde, lt: hastaProgramado } },
            { fechaVencimiento: { gte: desde, lt: hastaProgramado } },
            { fechaInicio: { gte: desde, lt: hastaProgramado } },
            { finalizadoAt: { gte: desde, lt: hastaProgramado } },
            { fechaParoProduccion: { gte: desde, lt: hastaProgramado } },
          ],
        },
        select: {
          maquinaId: true,
          createdAt: true,
          fechaVencimiento: true,
          fechaInicio: true,
          finalizadoAt: true,
          fechaParoProduccion: true,
        },
      }),
    ]);

    return [
      ...paros.map((p) => ({ maquinaId: p.maquinaId, inicio: p.inicio, fin: p.fin })),
      ...fallas.flatMap((f) => [
        { maquinaId: f.maquinaId, inicio: f.fechaFallaReportada, fin: f.fechaFallaReportada },
        ...(f.fechaFallaConfirmada ? [{ maquinaId: f.maquinaId, inicio: f.fechaFallaConfirmada, fin: f.fechaFallaConfirmada }] : []),
        ...(f.fechaRestauracion ? [{ maquinaId: f.maquinaId, inicio: f.fechaRestauracion, fin: f.fechaRestauracion }] : []),
      ]),
      ...tareas.flatMap((t) => [
        { maquinaId: t.maquinaId!, inicio: t.createdAt, fin: t.createdAt },
        ...(t.fechaVencimiento ? [{ maquinaId: t.maquinaId!, inicio: t.fechaVencimiento, fin: t.fechaVencimiento }] : []),
        ...(t.fechaInicio ? [{ maquinaId: t.maquinaId!, inicio: t.fechaInicio, fin: t.fechaInicio }] : []),
        ...(t.finalizadoAt ? [{ maquinaId: t.maquinaId!, inicio: t.finalizadoAt, fin: t.finalizadoAt }] : []),
        ...(t.fechaParoProduccion ? [{ maquinaId: t.maquinaId!, inicio: t.fechaParoProduccion, fin: t.fechaParoProduccion }] : []),
      ]),
    ];
  }
}
