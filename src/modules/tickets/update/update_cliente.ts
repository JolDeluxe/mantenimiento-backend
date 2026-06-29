// update/update_cliente.ts
// Edición restringida para CLIENTE_INTERNO:
//   - Solo puede editar tickets PROPIOS (creadorId === user.id)
//   - Solo cuando el estado es PENDIENTE
//   - No puede tocar: responsables, prioridad, fechaVencimiento, tiempoEstimado
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { processTicketImages } from "../create/helper_upload";
import { deleteImageByUrl } from "../../../utils/cloudinary";
import { notificarModificacionTarea } from "../../notificaciones/services";
import type { UpdateTicketParams, UpdateTicketInput } from "../zod";

export const updateTicketCliente = async (req: Request, res: Response) => {
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

    // Verificar propiedad
    if (tareaActual.creadorId !== user.id) {
      return res.status(403).json({ error: "No puedes editar un ticket ajeno." });
    }

    // Solo editable en PENDIENTE
    if (tareaActual.estado !== EstadoTarea.PENDIENTE) {
      return res.status(403).json({ error: "Ya no puedes editar este ticket." });
    }

    // Prohibir campos de admin
    if (data.responsables || data.prioridad || data.fechaVencimiento || data.tiempoEstimado) {
      return res.status(403).json({ error: "No tienes permisos administrativos." });
    }

    // ─── Máquina / Planta / Área ──────────────────────────────────────────────
    const categoriaFinal = data.categoria !== undefined ? data.categoria : tareaActual.categoria;
    let finalMaquinaId   = data.maquinaId !== undefined ? data.maquinaId : tareaActual.maquinaId;
    let finalPlanta      = data.planta    !== undefined ? data.planta    : tareaActual.planta;
    let finalArea        = data.area      !== undefined ? data.area      : tareaActual.area;

    if (categoriaFinal === "MAQUINARIA" && finalMaquinaId) {
      const maquinaDb = await prisma.maquina.findUnique({
        where: { id: finalMaquinaId },
        select: { planta: true, area: true, estado: true }
      });
      if (!maquinaDb) return res.status(400).json({ error: "La máquina seleccionada no existe." });
      if (maquinaDb.estado === "BAJA" || maquinaDb.estado === "BAJA_ERP") {
        return res.status(400).json({ error: "No se pueden asociar máquinas dadas de baja." });
      }
      finalPlanta    = maquinaDb.planta;
      finalArea      = maquinaDb.area;
    } else if (categoriaFinal !== "MAQUINARIA") {
      finalMaquinaId = null;
    }

    // ─── Transacción ──────────────────────────────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      const tareaActualizada = await tx.tarea.update({
        where: { id: ticketId },
        data: {
          titulo:            data.titulo       ?? undefined,
          descripcion:       data.descripcion  ?? undefined,
          categoria:         data.categoria    ?? undefined,
          planta:            finalPlanta       ?? undefined,
          area:              finalArea         ?? undefined,
          maquinaId:         finalMaquinaId,
          paroProduccion:    data.paroProduccion,
          impactoProduccion: data.impactoProduccion,
          horaInicioProgramada: data.horaInicioProgramada !== undefined
            ? (data.horaInicioProgramada ? new Date(data.horaInicioProgramada) : null)
            : undefined,
          horaFinProgramada: data.horaFinProgramada !== undefined
            ? (data.horaFinProgramada ? new Date(data.horaFinProgramada) : null)
            : undefined,
          refacciones:       data.refacciones !== undefined ? data.refacciones : undefined,
        },
        include: { responsables: true }
      });

      const notasCambio: string[] = [];
      if (data.titulo || data.descripcion) notasCambio.push("Cliente actualizó detalles del reporte");
      if (data.imagenes && data.imagenes.length > 0) notasCambio.push(`Cliente agregó ${data.imagenes.length} fotos`);
      if (data.imagenesEliminadas?.length) notasCambio.push("Cliente eliminó fotos erróneas");

      // Eliminar imágenes marcadas
      if (data.imagenesEliminadas && data.imagenesEliminadas.length > 0) {
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
            tareaId:        ticketId,
            usuarioId:      user.id,
            tipo:           TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: tareaActual.estado,
            estadoNuevo:    tareaActual.estado,
            nota:           `Edición (${user.rol}): ${notasCambio.join(". ")}`
          }
        });

        if (data.imagenes && data.imagenes.length > 0) {
          await tx.imagen.createMany({
            data: data.imagenes.map(url => ({
              url,
              tipo:        "EVIDENCIA_ACTUALIZACION",
              tareaId:     ticketId,
              historialId: historial.id
            }))
          });
        }
      }

      return tareaActualizada;
    });

    void notificarModificacionTarea(result, user.id);

    await registrarAccion("UPDATE_TAREA", user.id, `Actualización Tarea ID: ${ticketId}. Usuario: ${user.email}`);
    return res.json({ message: "Actualización correcta", data: result });

  } catch (error) {
    await registrarError("UPDATE_TICKET_CLIENTE", user.id, error);
    return res.status(500).json({ error: "Error al actualizar la tarea" });
  }
};
