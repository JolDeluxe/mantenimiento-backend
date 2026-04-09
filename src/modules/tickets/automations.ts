import { prisma } from "../../db";
import { EstadoTarea, TipoEvento } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { notificarCambioEstatus } from "../notificaciones/services";

const DIAS_PARA_CIERRE_AUTOMATICO = 2;

export const autoCloseResolvedTickets = async () => {
  try {
    const ahora = new Date();
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - DIAS_PARA_CIERRE_AUTOMATICO);

    // Buscar tickets resueltos que excedan el tiempo límite
    const ticketsExpirados = await prisma.tarea.findMany({
      where: {
        estado: EstadoTarea.RESUELTO,
        finalizadoAt: {
          lt: fechaLimite
        }
      },
      include: { responsables: true }
    });

    if (ticketsExpirados.length === 0) return;

    for (const ticket of ticketsExpirados) {
      await prisma.$transaction(async (tx) => {
        const tareaActualizada = await tx.tarea.update({
          where: { id: ticket.id },
          data: { 
            estado: EstadoTarea.CERRADO,
            updatedAt: ahora
            // finalizadoAt ya existe desde que pasó a RESUELTO, no se toca.
          }
        });

        await tx.historialTarea.create({
          data: {
            tareaId: ticket.id,
            usuarioId: ticket.creadorId, // Atribuimos el cierre automático al creador (o usa un ID de sistema si lo tienes configurado)
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: EstadoTarea.RESUELTO,
            estadoNuevo: EstadoTarea.CERRADO,
            nota: "Tarea CERRADA de manera automática: Sin interacción del cliente por más de 2 días."
          }
        });

        return tareaActualizada;
      });

      // Notificar y registrar en bitácora de servidor fuera de la transacción
      void notificarCambioEstatus(ticket, EstadoTarea.CERRADO, ticket.creadorId);
      await registrarAccion(
        "CIERRE_AUTOMATICO",
        ticket.creadorId,
        `Ticket ${ticket.id}: RESUELTO → CERRADO por inactividad (> 2 días)`
      );
    }

} catch (error) {
    await registrarError("AUTO_CLOSE_TICKETS", 0, error);
  }
};