import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { calcularMinutosProgramadosMX } from "../helper";
import { crearFallaProvisional } from "../../bi_maquinaria/services/confirmacion_falla_service";

export const createBatchTickets = async (req: Request, res: Response) => {
  const user = req.user!;
  const { tareas } = req.body;

  try {
    // ── PRE-CARGA: Resolver ubicaciones de máquinas antes de la transacción ──
    // Evita N queries dentro del loop y garantiza consistencia del Snapshot
    const maquinaIdsUnicos = [
      ...new Set(tareas.map((t: any) => t.maquinaId).filter(Boolean))
    ] as number[];

    const maquinasMap = new Map<number, { planta: string | null; area: string | null }>();

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
        let finalPlanta: string | null = tarea.planta ?? null;
        let finalArea: string | null = tarea.area || "General";
        let clasificacionFinal: ClasificacionTarea | null = null;

        if (tarea.maquinaId && maquinasMap.has(tarea.maquinaId)) {
          const ubicMaquina = maquinasMap.get(tarea.maquinaId)!;
          finalPlanta = ubicMaquina.planta;
          finalArea   = ubicMaquina.area;
          // Respetar clasificación enviada; si no hay, guardar como null (hacer opcional)
          clasificacionFinal = tarea.clasificacion
            ? (tarea.clasificacion as ClasificacionTarea)
            : null;
        } else if (tarea.clasificacion) {
          // Sin máquina pero con clasificación explícita (ej: infraestructura general)
          clasificacionFinal = tarea.clasificacion as ClasificacionTarea;
        }
        // Sin maquinaId and sin clasificacion → null (tarea de infraestructura genérica)

        const responsablesConnect = tieneResponsables
          ? tarea.responsables.map((id: number) => ({ id }))
          : [];

        const horaInicioProgramada = tarea.horaInicioProgramada ? new Date(tarea.horaInicioProgramada) : null;
        const horaFinProgramada = tarea.horaFinProgramada ? new Date(tarea.horaFinProgramada) : null;
        let tiempoEstimado = tarea.tiempoEstimado || null;
        if (horaInicioProgramada && horaFinProgramada) {
          const minutosProgramados = calcularMinutosProgramadosMX(horaInicioProgramada, horaFinProgramada);
          if (minutosProgramados !== null) tiempoEstimado = minutosProgramados;
        }

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
            tiempoEstimado,
            estado: estadoInicial,
            fechaVencimiento: tarea.fechaVencimiento ?? null,
            horaInicioProgramada,
            horaFinProgramada,
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

        // BI MAQUINARIA FASE 1: Falla provisional
        if (clasificacionFinal === ClasificacionTarea.CORRECTIVO && nuevoTicket.maquinaId) {
          await crearFallaProvisional(tx, {
            tareaId: nuevoTicket.id,
            maquinaId: nuevoTicket.maquinaId,
            fechaFallaReportada: nuevoTicket.createdAt,
          });
        }

        if (tarea.maquinaId && tarea.paroProduccion) {
          await tx.maquina.update({
            where: { id: tarea.maquinaId },
            data: { estado: "PARO_PRODUCCION" }
          });
        }

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
