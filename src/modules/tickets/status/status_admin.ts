// status/status_admin.ts
// Cambio de estado para SUPER_ADMIN / JEFE_MTTO / COORDINADOR_MTTO.
// Sin restricciones de pertenencia — puede mover cualquier ticket a cualquier estado válido.
// Maneja INSPECCION auto-close e intervalos (admin puede registrar trabajo directamente).
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { registrarError } from "../../../utils/logger";
import { processTicketImages } from "../create/helper_upload";
import { isValidTransition } from "../helper";
import type { ChangeTicketStatusParams, ChangeTicketStatusInput } from "../zod";
import { ejecutarCambioEstado } from "./_core";

export const changeStatusAdmin = async (req: Request, res: Response) => {
  const user = req.user!;
  const { id: ticketId } = req.params as unknown as ChangeTicketStatusParams;
  const data = req.body as ChangeTicketStatusInput;

  try {
    // Procesar imágenes
    const files = req.files as Express.Multer.File[] | undefined;
    const urlsImagenes = await processTicketImages(files);
    if (urlsImagenes.length > 0) data.imagenes = urlsImagenes;

    let { estado: nuevoEstado, nota, imagenes: imagenesFinales = [], fechaVencimiento, refacciones, maquinaOperativaAlResolver } = data;
    let { registroTiempoManual } = data;

    if (typeof registroTiempoManual === "string") {
      try { registroTiempoManual = JSON.parse(registroTiempoManual); } catch (_) {}
    }
    if (typeof refacciones === "string") {
      try { refacciones = JSON.parse(refacciones); } catch (_) {}
    }

    // Fetch ticket
    const ticket = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: { responsables: true }
    });
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    // Validar transición — el mapa de estados es intocable
    if (!isValidTransition(ticket.estado, nuevoEstado, ticket.clasificacion, ticket.categoria)) {
      return res.status(400).json({ error: `Transición no permitida: ${ticket.estado} → ${nuevoEstado}` });
    }

    return ejecutarCambioEstado({
      ticketId,
      ticket,
      nuevoEstado,
      nota,
      imagenesFinales,
      fechaVencimiento,
      refacciones,
      registroTiempoManual,
      maquinaOperativaAlResolver,
      user,
      req,
      res,
      autoCloseInspeccion: true,
      manejarIntervalos:   true,
    });

  } catch (error) {
    await registrarError("CHANGE_STATUS_ADMIN", user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};
