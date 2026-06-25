// src/modules/tickets/05_status.ts
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento, Rol, ClasificacionTarea } from "@prisma/client"; // Removido ClasificacionTarea si no se usa aquí
import { registrarError, registrarAccion } from "../../utils/logger";
import { processTicketImages } from "./create/helper_upload";
import { notificarCambioEstatus } from "../notificaciones/services"; 
import { isValidTransition } from "./helper";
import { deleteImageByUrl } from "../../utils/cloudinary";
import { getIO } from "../../utils/socket"; // Importación corregida según infraestructura
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
  
    let { estado: nuevoEstado, nota, imagenes: imagenesFinales = [], fechaVencimiento } = data;
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

    if (!isValidTransition(ticket.estado, nuevoEstado, ticket.clasificacion, ticket.categoria)) {
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
      if (nuevoEstado === EstadoTarea.CERRADO && (ticket.clasificacion as any) !== 'RUTINA' && ticket.categoria !== 'RUTINA') {
        return res.status(403).json({ error: "Solo el cliente o el jefe pueden cerrar el ticket definitivamente." });
      }
      if (ticket.estado === EstadoTarea.PENDIENTE) {
        return res.status(400).json({ error: "El ticket debe ser asignado antes de iniciarlo." });
      }
    } else if (!esAdminJefe) {
      return res.status(403).json({ error: "No tienes permisos para cambiar el estatus." });
    }

    // --- INTERCEPCIÓN DE INSPECCIÓN (AUTO-CIERRE) ---
    // Se ejecuta después de validar permisos y transiciones para que el técnico pueda enviar "RESUELTO"
    // y el sistema lo promueva a "CERRADO" automáticamente sin disparar errores de validación.
    if (nuevoEstado === EstadoTarea.RESUELTO && (ticket.clasificacion as any) === 'INSPECCION') {
      nuevoEstado = EstadoTarea.CERRADO;
      nota = nota ? `${nota} (Cierre automático por Inspección)` : "(Cierre automático por Inspección)";
    }

    const ahora = new Date();
    const esEstadoResolucion = nuevoEstado === EstadoTarea.RESUELTO || (nuevoEstado === EstadoTarea.CERRADO);
    
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
            tareaId:   ticketId,
            usuarioId: user.id,
            estado:    EstadoTarea.EN_PROGRESO,
            inicio:    inicioIntervaloManual,
            fin:       ahora,
            duracion:  minutosManualesDirectos
          }
        });

        await prisma.tarea.update({
          where: { id: ticketId },
          data: { duracionReal: minutosManualesDirectos }
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
      if (fechaVencimiento) {
        datosActualizacion.fechaVencimiento = fechaVencimiento;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const tareaActualizada = await tx.tarea.update({
        where: { id: ticketId },
        data: datosActualizacion
      });

      if (nuevoEstado === EstadoTarea.EN_PROGRESO && ticket.maquinaId && ticket.paroProduccion) {
        await tx.maquina.update({
          where: { id: ticket.maquinaId },
          data: { estado: "EN_REPARACION" }
        });
      }

      if (nuevoEstado === EstadoTarea.RECHAZADO && ticket.maquinaId && ticket.paroProduccion) {
        await tx.maquina.update({
          where: { id: ticket.maquinaId },
          data: { estado: "EN_REPARACION" }
        });
      }

      if (esEstadoResolucion && ticket.maquinaId) {
        await tx.maquina.update({
          where: { id: ticket.maquinaId },
          data: { fechaUltimoServicio: ahora }
        });

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
            NOT: { id: ticketId }
          }
        });

        if (otrosParosActivos === 0) {
          await tx.maquina.update({
            where: { id: ticket.maquinaId },
            data: { estado: "OPERATIVA" }
          });
        }
      }

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

      if (nuevoEstado === EstadoTarea.CERRADO && ((ticket.clasificacion as any) === 'RUTINA' || ticket.categoria === 'RUTINA')) {
        notaHistorial += ' [RUTINA]';
      }
      if (minutosManualesDirectos > 0) {
        notaHistorial += ` ||[META:TIEMPO_MANUAL]||`;
      }
      
      const historial = await tx.historialTarea.create({
        data: {
          tareaId:         ticketId,
          usuarioId:       user.id,
          tipo:            TipoEvento.CAMBIO_ESTADO,
          estadoAnterior:  ticket.estado,
          estadoNuevo:     nuevoEstado,
          nota:            notaHistorial
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

    void notificarCambioEstatus(ticket, nuevoEstado, user.id, user.rol);
    
    await registrarAccion(
      "CAMBIO_ESTATUS",
      user.id,
      `Ticket ${ticketId}: ${ticket.estado} → ${nuevoEstado} (Usuario: ${user.email})${minutosManualesDirectos > 0 ? ` | Tiempo manual: ${minutosManualesDirectos} min` : ''}${esCierreManualAtrasado ? ` | Fecha real configurada: ${fechaCierreReal.toISOString()}` : ''}`
    );

    // Integración de Sockets para actualización global
    try {
        const io = getIO();
        io.to("global_updates").emit("datos_actualizados", { module: "tickets" });
    } catch (_) {
        // Socket no crítico — no interrumpe el flujo
    }
    
    return res.json({ message: "Estatus actualizado correctamente", data: result });

  } catch (error) {
    await registrarError('CHANGE_STATUS', user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};