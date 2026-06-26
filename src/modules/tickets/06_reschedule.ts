import type { Request, Response } from "express";
import { prisma } from "../../db";
import { TipoEvento } from "@prisma/client";

export const rescheduleTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { ticketIds, nuevaFecha, motivo } = req.body;

    const fechaNueva = new Date(nuevaFecha);
    if (isNaN(fechaNueva.getTime())) {
      return res.status(400).json({ error: "La nueva fecha no es válida." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedTickets = [];

      for (const id of ticketIds) {
        const ticket = await tx.tarea.findUnique({
          where: { id },
          select: { id: true, fechaVencimiento: true, fechaVencimientoOriginal: true, estado: true }
        });

        if (!ticket) {
          throw new Error(`El ticket con ID ${id} no existe.`);
        }

        // Si fechaVencimientoOriginal es null, guardamos la fechaVencimiento actual
        const originalDate = ticket.fechaVencimientoOriginal ?? ticket.fechaVencimiento;

        const updated = await tx.tarea.update({
          where: { id },
          data: {
            fechaVencimientoOriginal: originalDate,
            fechaVencimiento: fechaNueva
          }
        });

        await tx.historialTarea.create({
          data: {
            tareaId: id,
            usuarioId: user.id,
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: ticket.estado,
            estadoNuevo: ticket.estado,
            nota: `Reprogramado masivamente por ${user.nombre}. Motivo: ${motivo}`
          }
        });

        updatedTickets.push(updated);
      }

      return updatedTickets;
    });

    return res.status(200).json({
      message: "Reprogramación exitosa.",
      ticketsActualizados: result.length
    });

  } catch (error: any) {
    console.error("Error en reprogramación de tickets:", error);
    return res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
};
