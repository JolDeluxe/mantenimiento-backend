// src/modules/tickets/create/create_batch.ts
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";

export const createBatchTickets = async (req: Request, res: Response) => {
  const user = req.user!;
  const { tareas } = req.body;

  try {
    // ── PRE-CARGA: Resolver ubicaciones de máquinas antes de la transacción ──
    // Evita N queries dentro del loop y garantiza consistencia del Snapshot
    const maquinaIdsUnicos = [
      ...new Set(tareas.map((t: any) => t.maquinaId).filter(Boolean))
    ] as number[];

    const maquinasMap = new Map<number, { planta: string; area: string }>();

    if (maquinaIdsUnicos.length > 0) {
      const maquinas = await prisma.maquina.findMany({
        where: { id: { in: maquinaIdsUnicos } },
        select: { id: true, planta: true, area: true }
      });
      maquinas.forEach(m => maquinasMap.set(m.id, { planta: m.planta, area: m.area }));
    }

    const results = await prisma.$transaction(async (tx) => {
      const ticketsCreados: { id: number; titulo: string }[] = [];

      for (const tarea of tareas) {
        const tieneResponsables = tarea.responsables && tarea.responsables.length > 0;
        const estadoInicial = tieneResponsables ? EstadoTarea.ASIGNADA : EstadoTarea.PENDIENTE;

        // ── SNAPSHOT: La ubicación de la máquina siempre gana ────────────────
        let finalPlanta = tarea.planta || "KAPPA";
        let finalArea   = tarea.area   || "General";
        let clasificacionFinal: ClasificacionTarea | null = null;

        if (tarea.maquinaId && maquinasMap.has(tarea.maquinaId)) {
          const ubicMaquina = maquinasMap.get(tarea.maquinaId)!;
          finalPlanta = ubicMaquina.planta;
          finalArea   = ubicMaquina.area;
          // Respetar clasificación enviada; si no hay, asumir PREVENTIVO (mantenimiento planificado)
          clasificacionFinal = tarea.clasificacion
            ? (tarea.clasificacion as ClasificacionTarea)
            : ClasificacionTarea.PREVENTIVO;
        } else if (tarea.clasificacion) {
          // Sin máquina pero con clasificación explícita (ej: infraestructura general)
          clasificacionFinal = tarea.clasificacion as ClasificacionTarea;
        }
        // Sin maquinaId y sin clasificacion → null (tarea de infraestructura genérica)

        const responsablesConnect = tieneResponsables
          ? tarea.responsables.map((id: number) => ({ id }))
          : [];

        const nuevoTicket = await tx.tarea.create({
          data: {
            titulo: tarea.titulo,
            descripcion: tarea.descripcion || "Sin descripción.",
            planta: finalPlanta,
            area: finalArea,
            categoria: tarea.categoria,
            tipo: tarea.tipo,
            clasificacion: clasificacionFinal,
            prioridad: tarea.prioridad,
            tiempoEstimado: tarea.tiempoEstimado || null,
            estado: estadoInicial,
            fechaVencimiento: tarea.fechaVencimiento ?? null,
            creadorId: user.id,
            departamentoId: tarea.departamentoId ?? user.departamentoId,
            responsables: { connect: responsablesConnect },
            maquinaId: tarea.maquinaId ?? null,
            paroProduccion: tarea.paroProduccion ?? false,
            impactoProduccion: tarea.impactoProduccion ?? null,
          },
        });

        await tx.historialTarea.create({
          data: {
            tareaId: nuevoTicket.id,
            usuarioId: user.id,
            tipo: TipoEvento.CREACION,
            estadoNuevo: estadoInicial,
            nota: tarea.maquinaId
              ? `Mantenimiento en equipo — inserción masiva.`
              : "Tarea registrada mediante inserción masiva (Batch)."
          }
        });

        ticketsCreados.push({ id: nuevoTicket.id, titulo: nuevoTicket.titulo });
      }

      return ticketsCreados;
    });

    await registrarAccion(
      "CREAR_BATCH_ADMIN",
      user.id,
      `Se crearon ${results.length} tareas masivas.`
    );

    return res.status(201).json({
      message: `${results.length} tareas creadas exitosamente.`,
      ids: results.map(r => r.id)
    });

  } catch (error) {
    await registrarError('CREATE_BATCH_ADMIN', user.id, error);
    return res.status(500).json({ error: "Error al procesar el lote de tareas." });
  }
};
