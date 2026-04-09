import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento, Rol, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { processTicketImages } from "./create/helper_upload";
import { notificarCambioEstatus } from "../notificaciones/services"; 
import { calcularMinutosEntreFechas, isValidTransition } from "./helper";
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
  
    const { estado: nuevoEstado, nota, imagenes: imagenesFinales = [], registroTiempoManual } = data;

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

    // --- VALIDACIÓN DE PERMISOS ---

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
    const datosActualizacion: Record<string, unknown> = { estado: nuevoEstado, updatedAt: ahora };

    // --- GESTIÓN DE INTERVALOS AUTOMÁTICOS ---

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
        const duracionMin = Math.floor(
          (ahora.getTime() - intervaloAbierto.inicio.getTime()) / 60000
        );
        await prisma.intervaloTiempo.update({
          where: { id: intervaloAbierto.id },
          data: { fin: ahora, duracion: duracionMin }
        });
        await prisma.tarea.update({
          where: { id: ticketId },
          data: { duracionReal: { increment: duracionMin } }
        });
      }
    }

    // --- GESTIÓN DE TIEMPO MANUAL RETROACTIVO ---

    const esEstadoResolucion = nuevoEstado === EstadoTarea.RESUELTO ||
      (esRutina && nuevoEstado === EstadoTarea.CERRADO);

    let minutosAdicionalesManual = 0;
    let inicioIntervaloManual: Date = ahora;
    let finIntervaloManual: Date = ahora;
    let hayTiempoManual = false;

    if (esEstadoResolucion && registroTiempoManual) {
      if (registroTiempoManual.inicioManual && registroTiempoManual.finManual) {
        inicioIntervaloManual = new Date(registroTiempoManual.inicioManual);
        finIntervaloManual    = new Date(registroTiempoManual.finManual);
        minutosAdicionalesManual = calcularMinutosEntreFechas(inicioIntervaloManual, finIntervaloManual);
      } else if (registroTiempoManual.duracionManualMinutos) {
        minutosAdicionalesManual = registroTiempoManual.duracionManualMinutos;
        finIntervaloManual    = ahora;
        inicioIntervaloManual = new Date(ahora.getTime() - minutosAdicionalesManual * 60000);
      }

      if (minutosAdicionalesManual > 0) {
        hayTiempoManual = true;

        await prisma.intervaloTiempo.create({
          data: {
            tareaId:  ticketId,
            usuarioId: user.id,
            estado:   EstadoTarea.EN_PROGRESO,
            inicio:   inicioIntervaloManual,
            fin:      finIntervaloManual,
            duracion: minutosAdicionalesManual
          }
        });

        await prisma.tarea.update({
          where: { id: ticketId },
          data: { duracionReal: { increment: minutosAdicionalesManual } }
        });
      }
    }

    // --- FECHAS DE CICLO DE VIDA ---

    if (esEstadoResolucion && !ticket.fechaInicio) {
      datosActualizacion.fechaInicio = hayTiempoManual ? inicioIntervaloManual : ahora;
    }

    if (nuevoEstado === EstadoTarea.RESUELTO || nuevoEstado === EstadoTarea.CERRADO) {
      if (!ticket.finalizadoAt) datosActualizacion.finalizadoAt = ahora;
    }

    if (nuevoEstado === EstadoTarea.RECHAZADO) {
      datosActualizacion.finalizadoAt = null;
    }

    // --- TRANSACCIÓN PRINCIPAL ---
    const result = await prisma.$transaction(async (tx) => {
      const tareaActualizada = await tx.tarea.update({
        where: { id: ticketId },
        data: datosActualizacion
      });

      // LÓGICA ESTRICTA DE DESTRUCCIÓN FÍSICA Y REEMPLAZO POR CANCELACIÓN
      if (nuevoEstado === EstadoTarea.CANCELADA) {
        const imagenesPrevias = await tx.imagen.findMany({
          where: {
            tareaId: ticketId,
            NOT: { url: { contains: "no-image.avif" } }
          }
        });

        if (imagenesPrevias.length > 0) {
          // Destruir físicamente en paralelo
          imagenesPrevias.forEach((img) => {
            deleteImageByUrl(img.url).catch(console.error);
          });

          // Reemplazar URL por placeholder lógico en la base de datos
          const urlCompletaPlaceholder = `${req.protocol}://${req.get("host")}/img/no-image.avif`;
          await tx.imagen.updateMany({
            where: { id: { in: imagenesPrevias.map((i) => i.id) } },
            data: {
              url: urlCompletaPlaceholder,
              tipo: "EXPIRADO"
            }
          });
        }

        // Bloqueo de seguridad: Si intentaron inyectar imágenes nuevas durante una cancelación
        if (imagenesFinales.length > 0) {
          imagenesFinales.forEach((url) => {
            deleteImageByUrl(url).catch(console.error);
          });
        }
      }

      // Generación de metadatos de historial limpios
      let notaHistorial = nota ? nota.trim() : "Sin observaciones";

      if (esRutina && nuevoEstado === EstadoTarea.CERRADO) {
        notaHistorial += ' [RUTINA]';
      }

      if (hayTiempoManual) {
        notaHistorial += ` [TIEMPO_MANUAL:${minutosAdicionalesManual}]`;
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

      // Solo guardamos en base de datos si NO estamos cancelando
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
      `Ticket ${ticketId}: ${ticket.estado} → ${nuevoEstado} (Usuario: ${user.email})${hayTiempoManual ? ` | Tiempo manual: ${minutosAdicionalesManual} min` : ''}`
    );
    
    return res.json({ message: "Estatus actualizado correctamente", data: result });

  } catch (error) {
    await registrarError('CHANGE_STATUS', user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};