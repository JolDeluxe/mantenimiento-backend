// src/modules/tickets/create/create_batch.ts
import type { Request, Response } from "express";
import { prisma } from "../../../db"; 
import { EstadoTarea, TipoEvento, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";

export const createBatchTickets = async (req: Request, res: Response) => {
  const user = req.user!;
  const { tareas } = req.body;

  try {
    const results = await prisma.$transaction(async (tx) => {
      const ticketsCreados: { id: number; titulo: string }[] = [];

      for (const tarea of tareas) {
        const tieneResponsables = tarea.responsables && tarea.responsables.length > 0;
        const estadoInicial = tieneResponsables ? EstadoTarea.ASIGNADA : EstadoTarea.PENDIENTE;
        
        // Clasificación: usar la enviada o deducir si es Rutina, si no usar PREVENTIVO
        const clasificacionFinal = tarea.clasificacion || (tarea.categoria === 'RUTINA' ? ClasificacionTarea.RUTINA : ClasificacionTarea.PREVENTIVO);

        const responsablesConnect = tieneResponsables
          ? tarea.responsables.map((id: number) => ({ id }))
          : [];

        const nuevoTicket = await tx.tarea.create({
          data: {
            titulo: tarea.titulo,
            descripcion: tarea.descripcion,
            planta: tarea.planta,
            area: tarea.area,
            categoria: tarea.categoria,
            tipo: tarea.tipo,
            clasificacion: clasificacionFinal,
            prioridad: tarea.prioridad,
            tiempoEstimado: tarea.tiempoEstimado || null,
            estado: estadoInicial,
            fechaVencimiento: tarea.fechaVencimiento ?? null,
            creadorId: user.id,
            departamentoId: user.departamentoId,
            responsables: { connect: responsablesConnect },
          },
        });

        await tx.historialTarea.create({
          data: {
            tareaId: nuevoTicket.id,
            usuarioId: user.id,
            tipo: TipoEvento.CREACION, 
            estadoNuevo: estadoInicial,
            nota: "Tarea registrada mediante inserción masiva (Batch)."
          }
        });

        ticketsCreados.push({ id: nuevoTicket.id, titulo: nuevoTicket.titulo });
      }

      return ticketsCreados;
    });

    await registrarAccion("CREAR_BATCH_ADMIN", user.id, `Se crearon ${results.length} tareas masivas.`);
    
    return res.status(201).json({ 
      message: `${results.length} tareas creadas exitosamente.`, 
      ids: results.map(r => r.id) 
    });

  } catch (error) {
    await registrarError('CREATE_BATCH_ADMIN', user.id, error);
    return res.status(500).json({ error: "Error al procesar el lote de tareas." });
  }
};
