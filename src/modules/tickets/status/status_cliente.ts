// status/status_cliente.ts
// Cambio de estado para CLIENTE_INTERNO:
//   - Debe ser el creador del ticket
//   - Solo puede actuar cuando el ticket está en RESUELTO
//   - Solo puede mover a CERRADO o RECHAZADO
//   - No maneja intervalos de tiempo
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea } from "@prisma/client";
import { registrarError } from "../../../utils/logger";
import { processTicketImages } from "../create/helper_upload";
import { isValidTransition } from "../helper";
import type { ChangeTicketStatusParams, ChangeTicketStatusInput } from "../zod";
import { ejecutarCambioEstado } from "./_core";

export const changeStatusCliente = async (req: Request, res: Response) => {
  const user = req.user!;
  const { id: ticketId } = req.params as unknown as ChangeTicketStatusParams;
  const data = req.body as ChangeTicketStatusInput;

  try {
    // Procesar imágenes
    const files = req.files as Express.Multer.File[] | undefined;
    const urlsImagenes = await processTicketImages(files);
    if (urlsImagenes.length > 0) data.imagenes = urlsImagenes;

    const { estado: nuevoEstado, nota, imagenes: imagenesFinales = [], fechaVencimiento, refacciones } = data;

    // Fetch ticket
    const ticket = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: { responsables: true }
    });
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    // Validar transición
    if (!isValidTransition(ticket.estado, nuevoEstado, ticket.clasificacion, ticket.categoria)) {
      return res.status(400).json({ error: `Transición no permitida: ${ticket.estado} → ${nuevoEstado}` });
    }

    // Reglas de negocio del cliente
    if (ticket.creadorId !== user.id) {
      return res.status(403).json({ error: "No puedes modificar un ticket que no es tuyo." });
    }
    const esAprobacionORechazoValido = ticket.estado === EstadoTarea.RESUELTO;
    const esCancelacionValida = ticket.estado === EstadoTarea.PENDIENTE && nuevoEstado === EstadoTarea.CANCELADA;

    if (!esAprobacionORechazoValido && !esCancelacionValida) {
      return res.status(403).json({ error: "Solo puedes validar el ticket cuando el técnico lo marque como RESUELTO, o cancelarlo cuando está PENDIENTE." });
    }
    if (nuevoEstado !== EstadoTarea.CERRADO && nuevoEstado !== EstadoTarea.RECHAZADO && nuevoEstado !== EstadoTarea.CANCELADA) {
      return res.status(400).json({ error: "Como cliente, solo puedes CERRAR, RECHAZAR o CANCELAR el ticket." });
    }

    return ejecutarCambioEstado({
      ticketId,
      ticket,
      nuevoEstado,
      nota,
      imagenesFinales,
      fechaVencimiento,
      refacciones,
      registroTiempoManual: undefined, // cliente no registra tiempo
      user,
      req,
      res,
      autoCloseInspeccion: false,
      manejarIntervalos:   false,
    });

  } catch (error) {
    await registrarError("CHANGE_STATUS_CLIENTE", user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};
