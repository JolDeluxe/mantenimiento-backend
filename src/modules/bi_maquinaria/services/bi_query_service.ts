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
}

export class BIQueryService {
  private static calidadesIncluidas(calidad: FailureQueryInput["calidad"]): CalidadDato[] {
    return calidad === "CONFIRMADOS"
      ? [CalidadDato.CONFIRMADO]
      : [CalidadDato.CONFIRMADO, CalidadDato.DATO_INCOMPLETO];
  }

  private static estadosFallaIncluidos(): EstadoFalla[] {
    return [EstadoFalla.ABIERTA, EstadoFalla.REHABILITADA, EstadoFalla.CERRADA];
  }

  /**
   * Obtiene la población de máquinas aplicando filtros de búsqueda y paginación.
   * Filtra estrictamente máquinas creadas después de hastaEfectivo.
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
      hastaEfectivo,
    } = params;

    const baseWhere: Prisma.MaquinaWhereInput = {
      createdAt: { lt: hastaEfectivo },
    };

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
    const { desde, hastaEfectivo, calidad } = input;

    if (maquinasIds.length === 0) return [];

    const calidades = BIQueryService.calidadesIncluidas(calidad);

    // Traer fallas confirmadas del periodo para estas máquinas
    const fallas = await prisma.fallaMaquina.findMany({
      where: {
        maquinaId: { in: maquinasIds },
        contabilizaComoFalla: true,
        confirmadoPorId: { not: null },
        estado: { in: BIQueryService.estadosFallaIncluidos() },
        calidadDato: { in: calidades },
        fechaFallaConfirmada: {
          gte: desde,
          lt: hastaEfectivo,
        },
      },
      orderBy: { fechaFallaConfirmada: "asc" },
    });

    return fallas;
  }

  /**
   * Obtiene la falla confirmada inmediatamente anterior a "desde" para cada máquina.
   * Evita N+1 ejecutando consultas paralelas controladas en lote por paginación.
   */
  static async obtenerFallasAnteriores(maquinasIds: number[], desde: Date, calidad: "CONFIRMADOS" | "CONFIRMADOS_E_INCOMPLETOS") {
    if (maquinasIds.length === 0) return [];

    const calidades = BIQueryService.calidadesIncluidas(calidad);
    const anteriores = await prisma.fallaMaquina.findMany({
      where: {
        maquinaId: { in: maquinasIds },
        contabilizaComoFalla: true,
        confirmadoPorId: { not: null },
        estado: { in: BIQueryService.estadosFallaIncluidos() },
        calidadDato: { in: calidades },
        fechaFallaConfirmada: { lt: desde },
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
}
