import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento, Prioridad, TipoTarea, ClasificacionTarea, Rol } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { isAdminOrJefe } from "./helper";
import { processTicketImages } from "./create/helper_upload";
import { deleteImageByUrl } from "../../utils/cloudinary";
import { notificarAsignacionTarea } from "../notificaciones/services"; 
import type { UpdateTicketParams, UpdateTicketInput } from "./zod";

export const updateTicket = async (req: Request, res: Response) => {
  const user = req.user!;
  const { id: ticketId } = req.params as unknown as UpdateTicketParams;
  const data = req.body as UpdateTicketInput;

  try {
    const files = req.files as Express.Multer.File[] | undefined;
    const urlsImagenesNuevas = await processTicketImages(files);
    if (urlsImagenesNuevas.length > 0) {
      data.imagenes = urlsImagenesNuevas;
    }

    const tareaActual = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: { responsables: { select: { id: true } } }
    });

    if (!tareaActual) return res.status(404).json({ error: "Tarea no encontrada" });

    const esAdmin = isAdminOrJefe(user.rol);
    const esCliente = user.rol === Rol.CLIENTE_INTERNO;
    const esCreador = tareaActual.creadorId === user.id;

    if (esCliente) {
        if (!esCreador) return res.status(403).json({ error: "No puedes editar un ticket ajeno." });
        if (tareaActual.estado !== EstadoTarea.PENDIENTE) return res.status(403).json({ error: "Ya no puedes editar este ticket." });
        
        if (data.responsables || data.prioridad || data.fechaVencimiento) {
            return res.status(403).json({ error: "No tienes permisos administrativos." });
        }
    } else if (!esAdmin) {
        return res.status(403).json({ error: "No tienes permisos para editar esta tarea." });
    }

    let nuevoEstado = tareaActual.estado;
    let cambioDeResponsables = false;
    let idsResponsables: { id: number }[] | undefined = undefined;

    if (data.responsables !== undefined && esAdmin) { 
        cambioDeResponsables = true;
        if (data.responsables.length > 0) {
            const usuariosActivos = await prisma.usuario.findMany({
                where: { id: { in: data.responsables }, estado: "ACTIVO" },
                select: { id: true }
            });
            if (usuariosActivos.length !== data.responsables.length) {
                return res.status(400).json({ error: "Responsables inválidos o inactivos." });
            }
        }
        idsResponsables = data.responsables.map(id => ({ id }));
        
        if (tareaActual.estado === EstadoTarea.PENDIENTE || tareaActual.estado === EstadoTarea.ASIGNADA) {
            nuevoEstado = (data.responsables.length > 0) ? EstadoTarea.ASIGNADA : EstadoTarea.PENDIENTE;
        }
    }

    let nuevaFechaVencimiento = undefined;
    if (data.fechaVencimiento && esAdmin) { 
        const fecha = new Date(data.fechaVencimiento);
        fecha.setHours(23, 59, 59, 999);
        nuevaFechaVencimiento = fecha;
    }

    const result = await prisma.$transaction(async (tx) => {
        const tareaActualizada = await tx.tarea.update({
            where: { id: ticketId },
            data: {
                titulo: esCliente ? data.titulo : undefined,
                descripcion: esCliente ? data.descripcion : undefined,
                categoria: esCliente ? data.categoria : undefined,
                planta: esCliente ? data.planta : undefined,
                area: esCliente ? data.area : undefined,
                prioridad: esAdmin ? data.prioridad : undefined,
                fechaVencimiento: nuevaFechaVencimiento,
                estado: nuevoEstado,
                responsables: idsResponsables ? { set: idsResponsables } : undefined,
                tipo: esAdmin ? data.tipo : undefined,
                clasificacion: esAdmin ? data.clasificacion : undefined,
            },
            include: { responsables: true }
        });

        let notasCambio: string[] = [];
        if (esAdmin) {
            if (cambioDeResponsables) {
                const num = data.responsables!.length;
                notasCambio.push(num > 0 ? `Asignados ${num} técnicos` : "Se retiraron técnicos");
            }
            if (nuevoEstado !== tareaActual.estado) notasCambio.push(`Estado: ${nuevoEstado}`);
            if (data.prioridad && data.prioridad !== tareaActual.prioridad) notasCambio.push(`Prioridad: ${data.prioridad}`);
            if (data.fechaVencimiento) notasCambio.push("Se actualizó fecha vencimiento");
        } 
        
        if (esCliente) {
            if (data.titulo || data.descripcion) notasCambio.push("Cliente actualizó detalles del reporte");
            if (data.imagenes && data.imagenes.length > 0) notasCambio.push(`Cliente agregó ${data.imagenes.length} fotos`);
            if (data.imagenesEliminadas?.length) notasCambio.push("Cliente eliminó fotos erróneas");
        }

        if (data.imagenesEliminadas && data.imagenesEliminadas.length > 0 && esCliente) {
            const imagenesABorrar = await tx.imagen.findMany({
                where: { id: { in: data.imagenesEliminadas }, tareaId: ticketId }
            });

            if (imagenesABorrar.length > 0) {
                for (const img of imagenesABorrar) {
                    await deleteImageByUrl(img.url).catch(console.error);
                }
                await tx.imagen.deleteMany({ where: { id: { in: data.imagenesEliminadas } } });
            }
        }

        if (notasCambio.length > 0 || (data.imagenes && data.imagenes.length > 0)) {
            const historial = await tx.historialTarea.create({
                data: {
                    tareaId: ticketId,
                    usuarioId: user.id,
                    tipo: TipoEvento.CAMBIO_ESTADO,
                    estadoAnterior: tareaActual.estado,
                    estadoNuevo: nuevoEstado,
                    nota: `Edición (${user.rol}): ${notasCambio.join(". ")}`
                }
            });

            if (data.imagenes && data.imagenes.length > 0) {
                await tx.imagen.createMany({
                    data: data.imagenes.map(url => ({
                        url,
                        tipo: "EVIDENCIA_ACTUALIZACION",
                        tareaId: ticketId,
                        historialId: historial.id
                    }))
                });
            }
        }

        return tareaActualizada;
    });

    if (cambioDeResponsables && data.responsables && data.responsables.length > 0) {
        void notificarAsignacionTarea(result, data.responsables);
    }

    await registrarAccion("UPDATE_TAREA", user.id, `Actualización Tarea ID: ${ticketId}. Usuario: ${user.email}`);
    return res.json({ message: "Actualización correcta", data: result });

  } catch (error) {
    await registrarError('UPDATE_TICKET', user.id, error);
    return res.status(500).json({ error: "Error al actualizar la tarea" });
  }
};