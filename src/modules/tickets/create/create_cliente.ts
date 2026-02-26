import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { createTicketClientSchema } from "../zod";
import { EstadoTarea, TipoEvento, TipoTarea, Prioridad, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { processTicketImages } from "./helper_upload";
import { notificarNuevoReporte } from "../../notificaciones/services";

export const createTicketCliente = async (req: Request, res: Response) => {
  const user = req.user!;

  const validation = createTicketClientSchema.safeParse(req.body);
  if (!validation.success) {
      return res.status(400).json({ error: "Datos inválidos", details: validation.error.issues });
  }
  const data = validation.data;

  let urlsImagenes: string[] = [];
  if (req.files && (req.files as Express.Multer.File[]).length > 0) {
      try {
          urlsImagenes = await processTicketImages(req.files as Express.Multer.File[]);
      } catch (error) {
          return res.status(500).json({ error: "Error al subir las evidencias." });
      }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const nuevaTarea = await tx.tarea.create({
        data: {
          titulo: data.titulo,
          descripcion: data.descripcion,
          categoria: data.categoria,
          clasificacion: data.clasificacion as ClasificacionTarea,
          planta: data.planta,
          area: data.area,
          prioridad: data.prioridad || Prioridad.MEDIA,
          tipo: TipoTarea.TICKET,
          estado: EstadoTarea.PENDIENTE,
          creadorId: user.id,
          departamentoId: user.departamentoId,
          duracionReal: 0,
        },
        include: { creador: true }
      });

      const historial = await tx.historialTarea.create({
        data: {
          tareaId: nuevaTarea.id,
          usuarioId: user.id,
          tipo: TipoEvento.CREACION,
          estadoNuevo: EstadoTarea.PENDIENTE,
          nota: "Ticket reportado por Cliente Interno"
        }
      });

      if (urlsImagenes.length > 0) {
        await tx.imagen.createMany({
          data: urlsImagenes.map(url => ({
            url,
            tipo: "EVIDENCIA_INICIAL",
            tareaId: nuevaTarea.id,
            historialId: historial.id
          }))
        });
      }

      return nuevaTarea;
    });

    void notificarNuevoReporte(result, result.creador);
    await registrarAccion("CREAR_TICKET_CLIENTE", user.id, `Ticket creado ID: ${result.id} | Título: ${result.titulo}`);

    return res.status(201).json({ message: "Ticket creado exitosamente", data: result });

  } catch (error) {
    await registrarError('CREATE_TICKET_CLIENTE', user.id, error);
    return res.status(500).json({ error: "Error interno al guardar el ticket" });
  }
};