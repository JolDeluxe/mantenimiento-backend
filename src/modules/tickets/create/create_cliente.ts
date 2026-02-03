import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { createTicketClientSchema } from "../zod";
import { EstadoTarea, TipoEvento, TipoTarea, Prioridad, ClasificacionTarea } from "@prisma/client";
import { registrarError } from "../../../utils/logger";
import { processTicketImages } from "./helper_upload";

export const createTicketCliente = async (req: Request, res: Response) => {
  const user = req.user!;
  const rawBody = { ...req.body };

  // Procesar Imágenes
  let urlsImagenes: string[] = [];
  try {
      const files = req.files as Express.Multer.File[] | undefined;
      urlsImagenes = await processTicketImages(files);
  } catch (error) {
      return res.status(500).json({ error: "Error al subir las evidencias." });
  }

  if (urlsImagenes.length > 0) {
      rawBody.imagenes = urlsImagenes;
  }

  // Validar datos
  const validation = createTicketClientSchema.safeParse(rawBody);
  
  if (!validation.success) {
      return res.status(400).json({ 
          error: "Datos inválidos", 
          details: validation.error.issues 
      });
  }
  
  const data = validation.data;

  try {
    // Transacción
    const result = await prisma.$transaction(async (tx) => {

      const nuevaTarea = await tx.tarea.create({
        data: {
          titulo: data.titulo,
          descripcion: data.descripcion,
          categoria: data.categoria,
          clasificacion: data.clasificacion as ClasificacionTarea,
          planta: data.planta,
          area: data.area,
          prioridad: (data.prioridad as Prioridad) || Prioridad.MEDIA,
          tipo: TipoTarea.TICKET,
          estado: EstadoTarea.PENDIENTE,
          creadorId: user.id,
          departamentoId: user.departamentoId,
          fechaVencimiento: null,
          tiempoEstimado: null,
          fechaInicio: null,
          finalizadoAt: null,
          duracionReal: 0,
        }
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

      if (data.imagenes && data.imagenes.length > 0) {
        await tx.imagen.createMany({
          data: data.imagenes.map(url => ({
            url,
            tipo: "EVIDENCIA_INICIAL",
            tareaId: nuevaTarea.id,
            historialId: historial.id
          }))
        });
      }

      return nuevaTarea;
    });

    return res.status(201).json({
        message: "Ticket creado exitosamente. Mantenimiento ha sido notificado.",
        data: result
    });

  } catch (error) {
    await registrarError('CREATE_TICKET_CLIENTE', user.id, error);
    return res.status(500).json({ error: "Error interno al guardar el ticket" });
  }
};