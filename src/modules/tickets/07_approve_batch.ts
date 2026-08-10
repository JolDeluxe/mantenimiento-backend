import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { ejecutarNotificacionEnSegundoPlano, notificarCambioEstatus } from "../notificaciones/services";
import { getIO } from "../../utils/socket";
import { recalcularEstadoMaquina } from "../maquinas/helper";

export const approveTicketsBatch = async (req: Request, res: Response) => {
  const user = req.user!;
  const { ticketIds, nota } = req.body;

  try {
    const ahora = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updatedTickets = [];

      for (const id of ticketIds) {
        const ticket = await tx.tarea.findUnique({
          where: { id },
          include: { responsables: true }
        });

        if (!ticket) {
          throw new Error(`El ticket con ID ${id} no existe.`);
        }

        // Solo aprobamos tickets que estén en estado RESUELTO
        if (ticket.estado !== EstadoTarea.RESUELTO) {
          continue;
        }

        const notaHistorial = nota ? nota.trim() : "Aprobación masiva";

        const updated = await tx.tarea.update({
          where: { id },
          data: {
            estado: EstadoTarea.CERRADO,
            updatedAt: ahora,
            finalizadoAt: ticket.finalizadoAt || ahora
          }
        });

        // Historial
        await tx.historialTarea.create({
          data: {
            tareaId: id,
            usuarioId: user.id,
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: ticket.estado,
            estadoNuevo: EstadoTarea.CERRADO,
            nota: notaHistorial
          }
        });

        if (ticket.maquinaId) {
          await tx.maquina.update({ 
            where: { id: ticket.maquinaId }, 
            data: { fechaUltimoServicio: ahora } 
          });

          await recalcularEstadoMaquina(ticket.maquinaId, tx, {
            tareaId: id,
            nuevoEstado: EstadoTarea.CERRADO,
            paroProduccion: ticket.paroProduccion
          });
        }

        // Notificar cambio de estatus de forma asíncrona
        ejecutarNotificacionEnSegundoPlano(
          "NOTIF_ASYNC_APROBACION_MASIVA",
          notificarCambioEstatus(ticket, EstadoTarea.CERRADO, user.id, user.rol)
        );

        updatedTickets.push(updated);
      }

      return updatedTickets;
    });

    if (result.length > 0) {
      await registrarAccion(
        "APROBACION_MASIVA_TICKETS",
        user.id,
        `Se aprobaron en lote ${result.length} tickets esperando aprobación.`
      );

      try {
        getIO().to("global_updates").emit("datos_actualizados", { module: "tickets" });
      } catch (_) { /* socket no crítico */ }
    }

    return res.status(200).json({
      message: `Se aprobaron exitosamente ${result.length} tareas.`,
      ticketsActualizados: result.length
    });

  } catch (error: any) {
    await registrarError("APPROVE_BATCH_TICKETS", user.id, error);
    console.error("Error en aprobación masiva de tickets:", error);
    return res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
};
