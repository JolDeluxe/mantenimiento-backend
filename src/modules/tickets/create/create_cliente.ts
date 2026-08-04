import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento, TipoTarea, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { processTicketImages } from "./helper_upload";
import { notificarNuevoReporte } from "../../notificaciones/services";
import type { CreateTicketClientResolvedDTO } from "../types";
import { crearFallaProvisional } from "../../bi_maquinaria/services/confirmacion_falla_service";

export const createTicketCliente = async (
  req: Request,
  res: Response,
  resolvedDTO: CreateTicketClientResolvedDTO
) => {
  const user = req.user!;

  let urlsImagenes: string[] = [];
  if (req.files && (req.files as Express.Multer.File[]).length > 0) {
    try {
      urlsImagenes = await processTicketImages(req.files as Express.Multer.File[]);
    } catch (error) {
      return res.status(500).json({ error: "Error al subir las evidencias." });
    }
  }

  try {
    const clasificacionFinal: ClasificacionTarea = ClasificacionTarea.CORRECTIVO;
    const estadoInicial: EstadoTarea = EstadoTarea.PENDIENTE;
    const notaHistorial = "Falla reportada por Cliente Interno.";

    const result = await prisma.$transaction(async (tx) => {
      const nuevaTarea = await tx.tarea.create({
        data: {
          titulo: resolvedDTO.titulo,
          descripcion: resolvedDTO.descripcion || "Sin descripción.",
          categoria: resolvedDTO.categoria,
          incidenteId: resolvedDTO.incidenteId,
          clasificacion: clasificacionFinal,
          planta: resolvedDTO.planta,
          area: resolvedDTO.area,
          prioridad: resolvedDTO.prioridad,
          tipo: TipoTarea.TICKET,
          estado: estadoInicial,
          creadorId: user.id,
          departamentoId: user.departamentoId,
          duracionReal: 0,
          maquinaId: resolvedDTO.maquinaId ?? null,
          paroProduccion: resolvedDTO.paroProduccion,
          fechaParoProduccion: resolvedDTO.fechaParoProduccion ?? null,
        },
        include: { creador: true }
      });

      const historial = await tx.historialTarea.create({
        data: {
          tareaId: nuevaTarea.id,
          usuarioId: user.id,
          tipo: TipoEvento.CREACION,
          estadoNuevo: estadoInicial,
          nota: notaHistorial
        }
      });

      // BI MAQUINARIA FASE 1: Falla provisional
      if (nuevaTarea.maquinaId) {
        await crearFallaProvisional(tx, {
          tareaId: nuevaTarea.id,
          maquinaId: nuevaTarea.maquinaId,
          fechaFallaReportada: nuevaTarea.fechaParoProduccion || nuevaTarea.createdAt,
        });
      }

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

      if (resolvedDTO.maquinaId && resolvedDTO.paroProduccion) {
        await tx.maquina.update({
          where: { id: resolvedDTO.maquinaId },
          data: { estado: "PARO_PRODUCCION" }
        });
      }

      return nuevaTarea;
    });

    void notificarNuevoReporte(result, result.creador);

    await registrarAccion(
      "CREAR_TICKET_CLIENTE",
      user.id,
      `Ticket creado ID: ${result.id} | Clasificación: ${clasificacionFinal}`
    );

    return res.status(201).json({ message: "Ticket creado exitosamente", data: result });

  } catch (error) {
    await registrarError('CREATE_TICKET_CLIENTE', user.id, error);
    return res.status(500).json({ error: "Error interno al guardar el ticket" });
  }
};
