import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { notificarCambioEstatus } from "../notificaciones/services";
import { getIO } from "../../utils/socket";

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

        // Interlock de máquina si aplica
        if (ticket.maquinaId) {
          await tx.maquina.update({ 
            where: { id: ticket.maquinaId }, 
            data: { fechaUltimoServicio: ahora } 
          });

          // Verificar si quedan otros paros activos
          const otrosParosActivos = await tx.tarea.count({
            where: {
              maquinaId: ticket.maquinaId,
              paroProduccion: true,
              estado: { 
                in: [
                  EstadoTarea.PENDIENTE, 
                  EstadoTarea.ASIGNADA, 
                  EstadoTarea.EN_PROGRESO, 
                  EstadoTarea.EN_PAUSA, 
                  EstadoTarea.RECHAZADO
                ] 
              },
              NOT: { id }
            }
          });

          if (otrosParosActivos === 0) {
            await tx.maquina.update({ 
              where: { id: ticket.maquinaId }, 
              data: { estado: "OPERATIVA" } 
            });
          }
        }

        // Notificar cambio de estatus de forma asíncrona
        void notificarCambioEstatus(ticket, EstadoTarea.CERRADO, user.id, user.rol);

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
