import { prisma } from "../../db";

export const getMaquinasDistinctValues = async () => {
  const [distinctPlantas, distinctAreas, distinctProcesos] = await Promise.all([
    prisma.maquina.findMany({ select: { planta: true }, distinct: ["planta"] }),
    prisma.maquina.findMany({ select: { area: true }, distinct: ["area"] }),
    prisma.maquina.findMany({ select: { proceso: true }, distinct: ["proceso"] })
  ]);

  return {
    plantas: distinctPlantas.map(m => m.planta).filter(Boolean).sort(),
    areas: distinctAreas.map(m => m.area).filter(Boolean).sort(),
    procesos: distinctProcesos.map(m => m.proceso).filter(Boolean).sort()
  };
};
