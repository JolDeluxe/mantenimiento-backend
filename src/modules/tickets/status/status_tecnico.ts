// status/status_tecnico.ts
// Cambio de estado para TECNICO:
//   - Debe ser responsable del ticket
//   - No puede CERRAR (salvo RUTINA/INSPECCION)
//   - No puede iniciar desde PENDIENTE
//   - Maneja apertura/cierre de IntervaloTiempo y tiempo manual
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, Rol } from "@prisma/client";
import { registrarError } from "../../../utils/logger";
import { processTicketImages } from "../create/helper_upload";
import { isValidTransition } from "../helper";
import type { ChangeTicketStatusParams, ChangeTicketStatusInput } from "../zod";
import { ejecutarCambioEstado } from "./_core";

export const changeStatusTecnico = async (req: Request, res: Response) => {
  const user = req.user!;
  const { id: ticketId } = req.params as unknown as ChangeTicketStatusParams;
  const data = req.body as ChangeTicketStatusInput;

  try {
    // Procesar imágenes
    const files = req.files as Express.Multer.File[] | undefined;
    const urlsImagenes = await processTicketImages(files);
    if (urlsImagenes.length > 0) data.imagenes = urlsImagenes;

    let { estado: nuevoEstado, nota, imagenes: imagenesFinales = [], fechaVencimiento, refacciones, maquinaOperativaAlResolver, fallaResolucion } = data;
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

    // Validar transición
    if (!isValidTransition(ticket.estado, nuevoEstado, ticket.clasificacion, ticket.categoria)) {
      return res.status(400).json({ error: `Transición no permitida: ${ticket.estado} → ${nuevoEstado}` });
    }

    // Reglas de negocio del técnico
    const esResponsable = ticket.responsables.some(r => r.id === user.id);
    if (!esResponsable) {
      return res.status(403).json({ error: "No estás asignado a este ticket." });
    }
    if (nuevoEstado === EstadoTarea.CERRADO
        && (ticket.clasificacion as unknown as string) !== "RUTINA"
        && ticket.categoria !== "RUTINA") {
      return res.status(403).json({ error: "Solo el cliente o el jefe pueden cerrar el ticket definitivamente." });
    }
    if (ticket.estado === EstadoTarea.PENDIENTE) {
      return res.status(400).json({ error: "El ticket debe ser asignado antes de iniciarlo." });
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
      fallaResolucion,
      user,
      req,
      res,
      autoCloseInspeccion: true,
      manejarIntervalos:   true,
    });

  } catch (error) {
    await registrarError("CHANGE_STATUS_TECNICO", user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};
