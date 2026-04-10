// src/modules/tickets/05_status.ts
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento, Rol, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { processTicketImages } from "./create/helper_upload";
import { notificarCambioEstatus } from "../notificaciones/services"; 
import { isValidTransition } from "./helper";
import { deleteImageByUrl } from "../../utils/cloudinary";
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
    let { registroTiempoManual } = data;

    if (typeof registroTiempoManual === 'string') {
        try { registroTiempoManual = JSON.parse(registroTiempoManual); } catch (e) {}
    }

    const ticket = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: { responsables: true } 
    });

    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    const esCliente    = user.rol === Rol.CLIENTE_INTERNO;
    const esTecnico    = user.rol === Rol.TECNICO;
    const esAdminJefe  = ([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO] as Rol[]).includes(user.rol);
    const esCreador    = ticket.creadorId === user.id;
    const esResponsable = ticket.responsables.some(r => r.id === user.id);
    const esRutina     = ticket.clasificacion === ClasificacionTarea.RUTINA;

    if (!isValidTransition(ticket.estado, nuevoEstado)) {
        return res.status(400).json({ 
            error: `Transición no permitida: ${ticket.estado} → ${nuevoEstado}` 
        });
    }

    if (esCliente) {
      if (!esCreador) {
        return res.status(403).json({ error: "No puedes modificar un ticket que no es tuyo." });
      }
      if (ticket.estado !== EstadoTarea.RESUELTO) {
        return res.status(403).json({ error: "Solo puedes validar el ticket cuando el técnico lo marque como RESUELTO." });
      }
      if (nuevoEstado !== EstadoTarea.CERRADO && nuevoEstado !== EstadoTarea.RECHAZADO) {
        return res.status(400).json({ error: "Como cliente, solo puedes CERRAR o RECHAZAR el ticket." });
      }
    } else if (esTecnico) {
      if (!esResponsable) {
        return res.status(403).json({ error: "No estás asignado a este ticket." });
      }
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
    const esEstadoResolucion = nuevoEstado === EstadoTarea.RESUELTO || (esRutina && nuevoEstado === EstadoTarea.CERRADO);
    
    let fechaCierreReal = ahora;
    let esCierreManualAtrasado = false;
    let minutosManualesDirectos = 0;

    if (esEstadoResolucion && registroTiempoManual) {
        if (registroTiempoManual.finManual) {
            fechaCierreReal = new Date(registroTiempoManual.finManual);
            fechaCierreReal.setHours(23, 59, 59, 999);
            
            if (fechaCierreReal > ahora) {
                fechaCierreReal = ahora;
            }
            esCierreManualAtrasado = true;
        } 
        
        // Fix: Se remueve el 'else' para permitir que el modal envíe fecha de cierre Y minutos trabajados simultáneamente.
        if (registroTiempoManual.duracionManualMinutos) {
            minutosManualesDirectos = Number(registroTiempoManual.duracionManualMinutos);
        }
    }

    const datosActualizacion: Record<string, unknown> = { estado: nuevoEstado, updatedAt: ahora };

    if (nuevoEstado === EstadoTarea.EN_PROGRESO && ticket.estado !== EstadoTarea.EN_PROGRESO) {
      if (!ticket.fechaInicio) datosActualizacion.fechaInicio = ahora;
      
      await prisma.intervaloTiempo.create({
        data: {
          tareaId: ticketId,
          usuarioId: user.id,
          inicio: ahora,
          estado: EstadoTarea.EN_PROGRESO
        }
      });
    }

    if (ticket.estado === EstadoTarea.EN_PROGRESO && nuevoEstado !== EstadoTarea.EN_PROGRESO) {
      const intervaloAbierto = await prisma.intervaloTiempo.findFirst({
        where: { tareaId: ticketId, fin: null },
        orderBy: { inicio: 'desc' }
      });

      if (intervaloAbierto) {
        const finValidado = (esCierreManualAtrasado && fechaCierreReal > intervaloAbierto.inicio)
            ? fechaCierreReal
            : (esCierreManualAtrasado ? intervaloAbierto.inicio : ahora);

        // Fix: Si inyectamos minutos manuales, anulamos la duración de la sesión abierta 
        // para que no se sumen duplicadamente.
        const duracionMin = minutosManualesDirectos > 0 
            ? 0 
            : Math.floor((finValidado.getTime() - intervaloAbierto.inicio.getTime()) / 60000);
            
        await prisma.intervaloTiempo.update({
          where: { id: intervaloAbierto.id },
          data: { fin: finValidado, duracion: duracionMin }
        });
        
        await prisma.tarea.update({
          where: { id: ticketId },
          data: { duracionReal: { increment: duracionMin } }
        });
      }
    }

    if (minutosManualesDirectos > 0) {
        const inicioIntervaloManual = new Date(ahora.getTime() - minutosManualesDirectos * 60000);
        await prisma.intervaloTiempo.create({
          data: {
            tareaId:  ticketId,
            usuarioId: user.id,
            estado:   EstadoTarea.EN_PROGRESO,
            inicio:   inicioIntervaloManual,
            fin:      ahora,
            duracion: minutosManualesDirectos
          }
        });

        await prisma.tarea.update({
          where: { id: ticketId },
          data: { duracionReal: { increment: minutosManualesDirectos } }
        });
    }

    if (esEstadoResolucion && !ticket.fechaInicio) {
      datosActualizacion.fechaInicio = minutosManualesDirectos > 0 
        ? new Date(ahora.getTime() - minutosManualesDirectos * 60000) 
        : ahora;
    }

    if (nuevoEstado === EstadoTarea.RESUELTO || nuevoEstado === EstadoTarea.CERRADO) {
      if (!ticket.finalizadoAt) datosActualizacion.finalizadoAt = esCierreManualAtrasado ? fechaCierreReal : ahora;
    }

    if (nuevoEstado === EstadoTarea.RECHAZADO) {
      datosActualizacion.finalizadoAt = null;
    }

    const result = await prisma.$transaction(async (tx) => {
      const tareaActualizada = await tx.tarea.update({
        where: { id: ticketId },
        data: datosActualizacion
      });

      if (nuevoEstado === EstadoTarea.CANCELADA) {
        const imagenesPrevias = await tx.imagen.findMany({
          where: {
            tareaId: ticketId,
            NOT: { url: { contains: "no-image.avif" } }
          }
        });

        if (imagenesPrevias.length > 0) {
          imagenesPrevias.forEach((img) => {
            deleteImageByUrl(img.url).catch(console.error);
          });

          const urlCompletaPlaceholder = `${req.protocol}://${req.get("host")}/img/no-image.avif`;
          await tx.imagen.updateMany({
            where: { id: { in: imagenesPrevias.map((i) => i.id) } },
            data: {
              url: urlCompletaPlaceholder,
              tipo: "EXPIRADO"
            }
          });
        }

        if (imagenesFinales.length > 0) {
          imagenesFinales.forEach((url) => {
            deleteImageByUrl(url).catch(console.error);
          });
        }
      }

      let notaHistorial = nota ? nota.trim() : "Sin observaciones";

      if (esRutina && nuevoEstado === EstadoTarea.CERRADO) {
        notaHistorial += ' [RUTINA]';
      }

      if (minutosManualesDirectos > 0) {
        notaHistorial += ` [TIEMPO_MANUAL:${minutosManualesDirectos}m]`;
      }
      
      if (esCierreManualAtrasado) {
        notaHistorial += ` [ENTREGA_ATRASADA_MANUAL]`;
      }

      const historial = await tx.historialTarea.create({
        data: {
          tareaId:       ticketId,
          usuarioId:     user.id,
          tipo:          TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: ticket.estado,
          estadoNuevo:   nuevoEstado,
          nota:          notaHistorial
        }
      });

      if (imagenesFinales.length > 0 && nuevoEstado !== EstadoTarea.CANCELADA) {
        let tipoEvidencia = "EVIDENCIA_AVANCE";
        if (nuevoEstado === EstadoTarea.RESUELTO)  tipoEvidencia = "EVIDENCIA_SOLUCION";
        else if (nuevoEstado === EstadoTarea.RECHAZADO) tipoEvidencia = "EVIDENCIA_RECHAZO";
        else if (nuevoEstado === EstadoTarea.CERRADO)   tipoEvidencia = "EVIDENCIA_CIERRE";

        await tx.imagen.createMany({
          data: imagenesFinales.map(url => ({
            url,
            tipo:       tipoEvidencia,
            tareaId:    ticketId,
            historialId: historial.id
          }))
        });
      }

      return tareaActualizada;
    });

    void notificarCambioEstatus(ticket, nuevoEstado, user.id);
    await registrarAccion(
      "CAMBIO_ESTATUS",
      user.id,
      `Ticket ${ticketId}: ${ticket.estado} → ${nuevoEstado} (Usuario: ${user.email})${minutosManualesDirectos > 0 ? ` | Tiempo manual: ${minutosManualesDirectos} min` : ''}${esCierreManualAtrasado ? ` | Fecha real configurada: ${fechaCierreReal.toISOString()}` : ''}`
    );
    
    return res.json({ message: "Estatus actualizado correctamente", data: result });

  } catch (error) {
    await registrarError('CHANGE_STATUS', user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};