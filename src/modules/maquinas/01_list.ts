import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Prisma, EstadoTarea } from "@prisma/client";
import type { ListMaquinasQuery, KpisMaquinaQuery } from "./zod";
import { getMaquinasDistinctValues } from "./helper";

export const listarMaquinas = async (req: Request, res: Response) => {
  try {
    const { q, estado, criticidad, proceso, planta, area, departamentoId, page = 1, limit = 20 } = req.query as unknown as ListMaquinasQuery;
    const offset = (page - 1) * limit;

    const where: Prisma.MaquinaWhereInput = {};

    if (estado) where.estado = estado;
    if (criticidad) where.criticidad = criticidad;
    if (proceso) where.proceso = { contains: proceso };
    if (planta) where.planta = { contains: planta };
    if (area) where.area = { contains: area };
    if (departamentoId) where.departamentoId = departamentoId;

    if (q) {
      const search = q.trim();
      where.OR = [
        { codigo: { contains: search } },
        { nombre: { contains: search } },
        { marca: { contains: search } },
        { modelo: { contains: search } },
        { numeroSerie: { contains: search } },
      ];
    }

    const [total, maquinas, catalogs] = await Promise.all([
      prisma.maquina.count({ where }),
      prisma.maquina.findMany({
        where,
        take: limit,
        skip: offset,
        include: { departamento: true },
        orderBy: { codigo: "asc" }
      }),
      getMaquinasDistinctValues()
    ]);

    return res.json({
      status: "success",
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      catalogs,
      data: maquinas
    });

  } catch (error) {
    console.error("Error al listar máquinas:", error);
    return res.status(500).json({ error: "Error interno al listar máquinas" });
  }
};

export const getMaquinaById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const maquina = await prisma.maquina.findUnique({
      where: { id },
      include: { departamento: true }
    });

    if (!maquina) {
      return res.status(404).json({ error: "Máquina no encontrada" });
    }

    return res.json({ status: "success", data: maquina });

  } catch (error) {
    console.error("Error al obtener detalle de máquina:", error);
    return res.status(500).json({ error: "Error interno al obtener detalle" });
  }
};

export const getMaquinaPrefill = async (req: Request, res: Response) => {
  try {
    const { codigo } = req.params;
    if (!codigo) {
      return res.status(400).json({ error: "Código de máquina no provisto" });
    }
    const maquina = await prisma.maquina.findUnique({
      where: { codigo: codigo.toUpperCase() },
      include: {
        tareas: {
          where: {
            estado: {
              in: [
                EstadoTarea.PENDIENTE,
                EstadoTarea.ASIGNADA,
                EstadoTarea.EN_PROGRESO,
                EstadoTarea.EN_PAUSA
              ]
            }
          },
          select: {
            id: true,
            titulo: true,
            estado: true,
            prioridad: true,
            responsables: { select: { nombre: true } }
          },
          take: 3
        }
      }
    });

    if (!maquina) {
      return res.status(404).json({ error: "Máquina no encontrada" });
    }

    const criticidadKey = (maquina.criticidad || "C") as "A" | "B" | "C";
    const sugeridaMap = {
      A: "ALTA",
      B: "MEDIA",
      C: "BAJA"
    };
    const prioridadSugerida = sugeridaMap[criticidadKey] || "MEDIA";

    return res.json({
      status: "success",
      data: {
        maquinaId: maquina.id,
        codigo: maquina.codigo,
        nombre: maquina.nombre,
        proceso: maquina.proceso,
        planta: maquina.planta,
        area: maquina.area,
        ubicacionDetalle: maquina.ubicacionDetalle,
        estadoActual: maquina.estado,
        criticidad: maquina.criticidad,
        tieneTicketsActivos: maquina.tareas.length > 0,
        ticketsActivos: maquina.tareas,
        prefill: {
          planta: maquina.planta,
          area: maquina.area,
          categoria: maquina.proceso, // El proceso de la máquina alimenta la categoría del ticket
          tituloSugerido: `Reporte de Falla: ${maquina.nombre} [${maquina.codigo}]`,
          prioridadSugerida
        }
      }
    });

  } catch (error) {
    console.error("Error en prefill de máquina:", error);
    return res.status(500).json({ error: "Error al prellenar datos de máquina" });
  }
};

export const getMaquinaKPIs = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { year, agruparPor = "mes" } = req.query as unknown as KpisMaquinaQuery;

    const maquina = await prisma.maquina.findUnique({ where: { id } });
    if (!maquina) {
      return res.status(404).json({ error: "Máquina no encontrada" });
    }

    const dateFilter: Record<string, any> = {};
    if (year) {
      const y = Number(year);
      dateFilter.gte = new Date(y, 0, 1);
      dateFilter.lte = new Date(y, 11, 31, 23, 59, 59, 999);
    }

    const tareas = await prisma.tarea.findMany({
      where: {
        maquinaId: id,
        estado: { in: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO] },
        createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
      },
      orderBy: { createdAt: "asc" }
    });

    const totalFallas = tareas.length;
    const tiempoReparacionTotal = tareas.reduce((acc, t) => acc + (t.duracionReal || 0), 0);
    const mttr = totalFallas > 0 ? Math.round(tiempoReparacionTotal / totalFallas) : null;

    let mtbfDays: number | null = null;
    const firstTask = tareas[0];
    const lastTask = tareas[totalFallas - 1];
    if (totalFallas > 1 && firstTask && lastTask) {
      const primerFalla = firstTask.createdAt.getTime();
      const ultimaFalla = lastTask.createdAt.getTime();
      const diffDias = (ultimaFalla - primerFalla) / (1000 * 60 * 60 * 24);
      mtbfDays = Math.round(diffDias / (totalFallas - 1));
    }

    // Buscar el último servicio de forma robusta
    let fechaUltimoServicio = maquina.fechaUltimoServicio;
    if (!fechaUltimoServicio) {
      const ultimaTarea = await prisma.tarea.findFirst({
        where: {
          maquinaId: id,
          estado: { in: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO] }
        },
        orderBy: { finalizadoAt: "desc" }
      });
      if (ultimaTarea) {
        fechaUltimoServicio = ultimaTarea.finalizadoAt || ultimaTarea.updatedAt || ultimaTarea.createdAt;
      }
    }

    // Tendencia agrupada temporal
    const tendenciaMap = new Map<string, { fallas: number; tiempo: number }>();

    tareas.forEach((t) => {
      const fecha = t.createdAt;
      let key = "";
      if (agruparPor === "mes") {
        key = `${fecha.getMonth() + 1}-${fecha.getFullYear()}`;
      } else {
        const inicioAnio = new Date(fecha.getFullYear(), 0, 1);
        const semana = Math.ceil(((fecha.getTime() - inicioAnio.getTime()) / 86400000 + inicioAnio.getDay() + 1) / 7);
        key = `${semana}-${fecha.getFullYear()}`;
      }

      const current = tendenciaMap.get(key) || { fallas: 0, tiempo: 0 };
      current.fallas += 1;
      current.tiempo += t.duracionReal || 0;
      tendenciaMap.set(key, current);
    });

    const tendencia = Array.from(tendenciaMap.entries()).map(([periodo, val]) => ({
      periodo,
      fallas: val.fallas,
      minutosReparacion: val.tiempo
    }));

    return res.json({
      status: "success",
      data: {
        resumen: {
          totalFallas,
          minutosReparacionAcumulados: tiempoReparacionTotal,
          mttrMinutos: mttr,
          mtbfDias: mtbfDays,
          fechaUltimoServicio: fechaUltimoServicio
        },
        tendencia
      }
    });

  } catch (error) {
    console.error("Error al calcular KPIs de máquina:", error);
    return res.status(500).json({ error: "Error al calcular KPIs" });
  }
};
