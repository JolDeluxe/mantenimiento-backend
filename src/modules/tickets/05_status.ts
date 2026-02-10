import type { Request, Response } from "express";
import { prisma } from "../../db";
import { changeStatusSchema } from "./zod";
import { EstadoTarea, TipoEvento, Rol } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { processTicketImages } from "./create/helper_upload";
// --- NUEVO IMPORT ---
import { notificarCambioEstatus } from "../notificaciones/services"; 

export const changeTicketStatus = async (req: Request, res: Response) => {
  const user = req.user!;
  const ticketId = Number(req.params.id);

  if (isNaN(ticketId)) return res.status(400).json({ error: "ID inválido" });

  const rawBody = { ...req.body };
  
  // 1. SUBIR IMÁGENES
  let urlsImagenes: string[] = [];
  try {
      const files = req.files as Express.Multer.File[] | undefined;
      urlsImagenes = await processTicketImages(files);
  } catch (error) {
      return res.status(500).json({ error: "Error al subir evidencias." });
  }

  if (urlsImagenes.length > 0) {
      rawBody.imagenes = urlsImagenes;
  }

  // 2. VALIDAR ZOD
  const validation = changeStatusSchema.safeParse(rawBody);
  if (!validation.success) {
    return res.status(400).json({ error: "Datos inválidos", details: validation.error.issues });
  }
  
  const { estado: nuevoEstado, nota } = validation.data;
  const imagenesFinales = urlsImagenes.length > 0 ? urlsImagenes : [];

  try {
    // 3. OBTENER TICKET
    // MODIFICACIÓN: Traemos 'responsables: true' completo para pasar el objeto al servicio de notificaciones sin errores de tipo
    const ticket = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: { responsables: true } 
    });

    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    // 4. LÓGICA DE PERMISOS
    
    const esCliente = user.rol === Rol.CLIENTE_INTERNO;
    const esTecnico = user.rol === Rol.TECNICO;
    
    // Casteamos el array a Rol[] para compatibilidad TS
    const esAdminJefe = ([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO] as Rol[]).includes(user.rol);
    
    const esCreador = ticket.creadorId === user.id;
    const esResponsable = ticket.responsables.some(r => r.id === user.id);

    // --- REGLAS PARA CLIENTE ---
    if (esCliente) {
        if (!esCreador) return res.status(403).json({ error: "No puedes modificar un ticket que no es tuyo." });
        
        if (ticket.estado !== EstadoTarea.RESUELTO) {
             return res.status(403).json({ error: "Solo puedes validar el ticket cuando el técnico lo marque como RESUELTO." });
        }

        if (nuevoEstado !== EstadoTarea.CERRADO && nuevoEstado !== EstadoTarea.RECHAZADO) {
            return res.status(400).json({ error: "Como cliente, solo puedes CERRAR o RECHAZAR el ticket." });
        }
    }
    
    // --- REGLAS PARA TÉCNICO ---
    else if (esTecnico) {
        if (!esResponsable) return res.status(403).json({ error: "No estás asignado a este ticket." });
        
        if (nuevoEstado === EstadoTarea.CERRADO) {
            return res.status(403).json({ error: "Solo el cliente o el jefe pueden cerrar el ticket definitivamente." });
        }
        
        if (ticket.estado === EstadoTarea.PENDIENTE) {
             return res.status(400).json({ error: "El ticket debe ser asignado antes de iniciarlo." });
        }
    }

    // --- REGLAS PARA ADMIN/JEFE ---
    else if (!esAdminJefe) {
        return res.status(403).json({ error: "No tienes permisos para cambiar el estatus." });
    }

    // 5. LÓGICA DE TIEMPOS
    const ahora = new Date();
    let datosActualizacion: any = { 
        estado: nuevoEstado,
        updatedAt: ahora
    };

    // A. Inicio de trabajo
    if (nuevoEstado === EstadoTarea.EN_PROGRESO && ticket.estado !== EstadoTarea.EN_PROGRESO) {
        if (!ticket.fechaInicio) {
            datosActualizacion.fechaInicio = ahora;
        }
        
        await prisma.intervaloTiempo.create({
            data: {
                tareaId: ticketId,
                usuarioId: user.id, 
                inicio: ahora,
                estado: EstadoTarea.EN_PROGRESO
            }
        });
    }

    // B. Fin de trabajo
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

    // C. FinalizadoAt
    if (nuevoEstado === EstadoTarea.RESUELTO && ticket.estado !== EstadoTarea.RESUELTO) {
        datosActualizacion.finalizadoAt = ahora;
    }
    if (nuevoEstado === EstadoTarea.RECHAZADO) {
        datosActualizacion.finalizadoAt = null; 
    }

    // 6. TRANSACCIÓN DB
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
                // Forzamos el tipo 'as EstadoTarea' para calmar a Prisma/TS si viene como string
                estadoNuevo: nuevoEstado as EstadoTarea,
                nota: nota || `Cambio de estado: ${ticket.estado} -> ${nuevoEstado}`
            }
        });

        if (imagenesFinales.length > 0) {
            let tipoEvidencia = "EVIDENCIA_AVANCE";

            if (nuevoEstado === EstadoTarea.RESUELTO) tipoEvidencia = "EVIDENCIA_SOLUCION";
            else if (nuevoEstado === EstadoTarea.RECHAZADO) tipoEvidencia = "EVIDENCIA_RECHAZO";
            else if (nuevoEstado === EstadoTarea.CERRADO) tipoEvidencia = "EVIDENCIA_CIERRE";

            await tx.imagen.createMany({
                data: imagenesFinales.map(url => ({
                    url,
                    tipo: tipoEvidencia,
                    tareaId: ticketId,
                    historialId: historial.id
                }))
            });
        }

        return tareaActualizada;
    });

    // --- INTEGRACIÓN DE NOTIFICACIONES ---
    // Usamos el objeto 'ticket' original que ya tiene los responsables cargados.
    // 'user.id' es el actorId para evitar auto-notificaciones.
    void notificarCambioEstatus(ticket, nuevoEstado as EstadoTarea, user.id);
    // -------------------------------------

    // --- LOGGING EN BITÁCORA ---
    await registrarAccion(
        "CAMBIO_ESTATUS", 
        user.id, 
        `Ticket ${ticketId}: ${ticket.estado} -> ${nuevoEstado} (Usuario: ${user.email})`
    );
    // ---------------------------

    return res.json({ message: "Estatus actualizado correctamente", data: result });

  } catch (error) {
    await registrarError('CHANGE_STATUS', user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};