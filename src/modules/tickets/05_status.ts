import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento, Rol, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { processTicketImages } from "./create/helper_upload";
import { notificarCambioEstatus } from "../notificaciones/services"; 
import type { ChangeTicketStatusParams, ChangeTicketStatusInput } from "./zod";

export const changeTicketStatus = async (req: Request, res: Response) => {
  const user = req.user!;
  const { id: ticketId } = req.params as unknown as ChangeTicketStatusParams;
  const data = req.body as ChangeTicketStatusInput;

  try {
    const files = req.files as Express.Multer.File[] | undefined;
    const urlsImagenes = await processTicketImages(files);
    
    if (urlsImagenes.length > 0) {
      data.imagenes = urlsImagenes;
    }
  
    const { estado: nuevoEstado, nota, imagenes: imagenesFinales = [] } = data;

    const ticket = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: { responsables: true } 
    });

    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    const esCliente = user.rol === Rol.CLIENTE_INTERNO;
    const esTecnico = user.rol === Rol.TECNICO;
    const esAdminJefe = ([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO] as Rol[]).includes(user.rol);
    const esCreador = ticket.creadorId === user.id;
    const esResponsable = ticket.responsables.some(r => r.id === user.id);
    
    // --- LÓGICA DE FAST-TRACK PARA RUTINAS ---
    const esRutina = ticket.clasificacion === ClasificacionTarea.RUTINA;

    if (esCliente) {
        if (!esCreador) return res.status(403).json({ error: "No puedes modificar un ticket que no es tuyo." });
        if (ticket.estado !== EstadoTarea.RESUELTO) {
             return res.status(403).json({ error: "Solo puedes validar el ticket cuando el técnico lo marque como RESUELTO." });
        }
        if (nuevoEstado !== EstadoTarea.CERRADO && nuevoEstado !== EstadoTarea.RECHAZADO) {
            return res.status(400).json({ error: "Como cliente, solo puedes CERRAR o RECHAZAR el ticket." });
        }
    } else if (esTecnico) {
        if (!esResponsable) return res.status(403).json({ error: "No estás asignado a este ticket." });
        
        // El técnico puede cerrar directamente SOLO si es una rutina.
        if (nuevoEstado === EstadoTarea.CERRADO && !esRutina) {
            return res.status(403).json({ error: "Solo el cliente o el jefe pueden cerrar el ticket definitivamente." });
        }
        
        if (ticket.estado === EstadoTarea.PENDIENTE) {
             return res.status(400).json({ error: "El ticket debe ser asignado antes de iniciarlo." });
        }
    } else if (!esAdminJefe) {
        return res.status(403).json({ error: "No tienes permisos para cambiar el estatus." });
    }

    const ahora = new Date();
    let datosActualizacion: any = { estado: nuevoEstado, updatedAt: ahora };

    // Solo iniciamos cronómetro si deciden ponerla EN_PROGRESO (opcional para rutinas)
    if (nuevoEstado === EstadoTarea.EN_PROGRESO && ticket.estado !== EstadoTarea.EN_PROGRESO) {
        if (!ticket.fechaInicio) datosActualizacion.fechaInicio = ahora;
        
        await prisma.intervaloTiempo.create({
            data: {
                tareaId: ticketId, usuarioId: user.id, inicio: ahora, estado: EstadoTarea.EN_PROGRESO
            }
        });
    }

    // Detenemos cronómetro si estaba corriendo
    if ((ticket.estado === EstadoTarea.EN_PROGRESO) && (nuevoEstado !== EstadoTarea.EN_PROGRESO)) {
        const intervaloAbierto = await prisma.intervaloTiempo.findFirst({
            where: { tareaId: ticketId, fin: null },
            orderBy: { inicio: 'desc' }
        });

        if (intervaloAbierto) {
            const fin = ahora;
            const duracionMs = fin.getTime() - intervaloAbierto.inicio.getTime();
            const duracionMin = Math.floor(duracionMs / 60000);

            await prisma.intervaloTiempo.update({
                where: { id: intervaloAbierto.id },
                data: { fin, duracion: duracionMin }
            });

            await prisma.tarea.update({
                where: { id: ticketId },
                data: { duracionReal: { increment: duracionMin } }
            });
        }
    }

    // Marca de finalización simple, sin inyectar tiempos falsos
    if (nuevoEstado === EstadoTarea.RESUELTO || nuevoEstado === EstadoTarea.CERRADO) {
        if (!ticket.finalizadoAt) datosActualizacion.finalizadoAt = ahora;
    }

    if (nuevoEstado === EstadoTarea.RECHAZADO) {
        datosActualizacion.finalizadoAt = null; 
    }

    const result = await prisma.$transaction(async (tx) => {
        const tareaActualizada = await tx.tarea.update({
            where: { id: ticketId },
            data: datosActualizacion
        });

        const historial = await tx.historialTarea.create({
            data: {
                tareaId: ticketId,
                usuarioId: user.id,
                tipo: TipoEvento.CAMBIO_ESTADO,
                estadoAnterior: ticket.estado,
                estadoNuevo: nuevoEstado,
                nota: nota || `Cambio de estado: ${ticket.estado} -> ${nuevoEstado}${esRutina && nuevoEstado === EstadoTarea.CERRADO ? ' (Rutina Completada)' : ''}`
            }
        });

        if (imagenesFinales.length > 0) {
            let tipoEvidencia = "EVIDENCIA_AVANCE";
            if (nuevoEstado === EstadoTarea.RESUELTO) tipoEvidencia = "EVIDENCIA_SOLUCION";
            else if (nuevoEstado === EstadoTarea.RECHAZADO) tipoEvidencia = "EVIDENCIA_RECHAZO";
            else if (nuevoEstado === EstadoTarea.CERRADO) tipoEvidencia = "EVIDENCIA_CIERRE";

            await tx.imagen.createMany({
                data: imagenesFinales.map(url => ({
                    url, tipo: tipoEvidencia, tareaId: ticketId, historialId: historial.id
                }))
            });
        }

        return tareaActualizada;
    });

    void notificarCambioEstatus(ticket, nuevoEstado, user.id);
    await registrarAccion("CAMBIO_ESTATUS", user.id, `Ticket ${ticketId}: ${ticket.estado} -> ${nuevoEstado} (Usuario: ${user.email})`);
    
    return res.json({ message: "Estatus actualizado correctamente", data: result });

  } catch (error) {
    await registrarError('CHANGE_STATUS', user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};