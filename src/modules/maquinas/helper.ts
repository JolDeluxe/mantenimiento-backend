import { prisma } from "../../db";

const PLANTAS_EXCLUIDAS = new Set(["BAJA", "GENERAL", "INACTIVA", "CERRADA"]);

export const getPlantasOperativas = async (): Promise<string[]> => {
  const distinctResult = await prisma.maquina.findMany({
    select: { planta: true },
    distinct: ["planta"]
  });

  return distinctResult
    .map(m => m.planta?.trim().toUpperCase())
    .filter((p): p is string => typeof p === 'string' && !PLANTAS_EXCLUIDAS.has(p))
    .sort();
};

export const getMaquinasDistinctValues = async () => {
  const [distinctPlantas, distinctAreas, distinctProcesos] = await Promise.all([
    getPlantasOperativas(),
    prisma.maquina.findMany({ select: { area: true }, distinct: ["area"] }),
    prisma.maquina.findMany({ select: { proceso: true }, distinct: ["proceso"] })
  ]);

  return {
    plantas: Array.isArray(distinctPlantas) ? distinctPlantas : [],
    areas: distinctAreas.map(m => m.area).filter(Boolean).sort(),
    procesos: distinctProcesos.map(m => m.proceso).filter(Boolean).sort()
  };
};

