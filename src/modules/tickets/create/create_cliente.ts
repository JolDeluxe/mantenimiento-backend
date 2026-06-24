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
    // ── PATRÓN SNAPSHOT: Si hay máquina, heredar planta y área de la BD ──────
    let finalPlanta = data.planta;
    let finalArea   = data.area;

    if (data.maquinaId) {
      const maquinaDb = await prisma.maquina.findUnique({
        where: { id: data.maquinaId },
        select: { planta: true, area: true }
      });
      if (maquinaDb) {
        // La verdad de la ubicación viene de la máquina, ignorar lo que envíe el frontend
        finalPlanta = maquinaDb.planta;
        finalArea   = maquinaDb.area;
      }
    }

    // ── FAT BACKEND: Clasificación y estado deducidos de la bandera TPM ───────
    const esAutonomo = data.esMantenimientoAutonomo === true;

    const clasificacionFinal: ClasificacionTarea = esAutonomo
      ? ClasificacionTarea.AUTONOMO
      : ClasificacionTarea.CORRECTIVO;

    const estadoInicial: EstadoTarea = esAutonomo
      ? EstadoTarea.RESUELTO   // Ya lo resolvió el operario — no entra a bandeja pendiente
      : EstadoTarea.PENDIENTE;

    const prioridadFinal: Prioridad = esAutonomo
      ? Prioridad.BAJA         // Registro histórico — no es urgente
      : (data.prioridad || Prioridad.MEDIA);

    const notaHistorial = esAutonomo
      ? "Mantenimiento autónomo registrado y auto-resuelto por el operario."
      : "Falla reportada por Cliente Interno.";

    const result = await prisma.$transaction(async (tx) => {
      const nuevaTarea = await tx.tarea.create({
        data: {
          titulo: data.titulo,
          descripcion: data.descripcion || "Sin descripción.",
          categoria: data.categoria,
          clasificacion: clasificacionFinal,
          planta: finalPlanta,
          area: finalArea,
          prioridad: prioridadFinal,
          tipo: TipoTarea.TICKET,
          estado: estadoInicial,
          creadorId: user.id,
          departamentoId: user.departamentoId,
          duracionReal: 0,
          maquinaId: data.maquinaId ?? null,
          paroProduccion: data.paroProduccion,
          impactoProduccion: data.impactoProduccion ?? null,
          // Si es autónomo, registrar el cierre inmediatamente
          ...(esAutonomo && { finalizadoAt: new Date(), fechaInicio: new Date() }),
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

      if (urlsImagenes.length > 0) {
        await tx.imagen.createMany({
          data: urlsImagenes.map(url => ({
            url,
            tipo: esAutonomo ? "EVIDENCIA_AUTONOMO" : "EVIDENCIA_INICIAL",
            tareaId: nuevaTarea.id,
            historialId: historial.id
          }))
        });
      }

      return nuevaTarea;
    });

    // Solo notificar al equipo de mantenimiento si es falla real (no autónomo)
    if (!esAutonomo) {
      void notificarNuevoReporte(result, result.creador);
    }

    await registrarAccion(
      "CREAR_TICKET_CLIENTE",
      user.id,
      `Ticket creado ID: ${result.id} | Clasificación: ${clasificacionFinal}${esAutonomo ? ' | AUTÓNOMO auto-resuelto' : ''}`
    );

    return res.status(201).json({ message: "Ticket creado exitosamente", data: result });

  } catch (error) {
    await registrarError('CREATE_TICKET_CLIENTE', user.id, error);
    return res.status(500).json({ error: "Error interno al guardar el ticket" });
  }
};