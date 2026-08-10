import { prisma } from "../../../db";

export class BIFilterService {
  /**
   * Obtiene los catálogos de filtros disponibles basados en la población de máquinas.
   */
  static async obtenerFiltros() {
    const [maquinasTotales, maquinasConAreaNula, limitesMaquinas, maquinas] = await Promise.all([
      prisma.maquina.count(),
      prisma.maquina.count({ where: { area: null } }),
      prisma.maquina.aggregate({
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      prisma.maquina.findMany({
        select: {
          proceso: true,
          area: true,
          criticidad: true,
          estado: true,
        },
      }),
    ]);

    const procesosSet = new Set<string>();
    const areasSet = new Set<string>();
    const criticidadesSet = new Set<string>();
    const estadosSet = new Set<string>();

    for (const m of maquinas) {
      if (m.proceso) procesosSet.add(m.proceso.trim());
      if (m.area) areasSet.add(m.area.trim());
      if (m.criticidad) criticidadesSet.add(m.criticidad.trim());
      if (m.estado) estadosSet.add(m.estado.trim());
    }

    return {
      success: true,
      metadata: {
        maquinasTotales,
        maquinasConAreaNula,
        primerRegistroMaquina: limitesMaquinas._min.createdAt?.toISOString() ?? null,
        ultimoRegistroMaquina: limitesMaquinas._max.createdAt?.toISOString() ?? null,
      },
      data: {
        procesos: Array.from(procesosSet).sort((a, b) => a.localeCompare(b)),
        areas: Array.from(areasSet).sort((a, b) => a.localeCompare(b)),
        criticidades: Array.from(criticidadesSet).sort((a, b) => a.localeCompare(b)),
        estadosActuales: Array.from(estadosSet).sort((a, b) => a.localeCompare(b)),
      },
    };
  }
}
