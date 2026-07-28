// src/modules/tickets/create/create_admin.ts
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { createTicketAdminSchema } from "../zod";
import { EstadoTarea, TipoEvento, TipoTarea, ClasificacionTarea, Prioridad } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { processTicketImages } from "./helper_upload";
import { notificarAsignacionTarea } from "../../notificaciones/services";
import { calcularMinutosProgramadosMX } from "../helper";

export const createTicketAdmin = async (req: Request, res: Response) => {
  const user = req.user!;

  const validation = createTicketAdminSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: "Datos inválidos", details: validation.error.issues });
  }
  const data = validation.data;

  let urlsImagenes: string[] = [];
  if (req.files && (req.files as Express.Multer.File[]).length > 0) {
    try {
      urlsImagenes = await processTicketImages(req.files as Express.Multer.File[]);
    } catch (error) {
      return res.status(500).json({ error: "Error al subir evidencias." });
    }
  }

  try {
    if (data.tipo === TipoTarea.TICKET) {
      return res.status(400).json({
        error: "Los administradores solo pueden crear tareas PLANEADAS o EXTRAORDINARIAS."
      });
    }

    // ── PATRÓN SNAPSHOT: planta y área se heredan de la máquina si existe ────
    let finalPlanta: string | null = data.planta ?? null;
    let finalArea   = data.area   || "General";
    let finalClasificacion: ClasificacionTarea | null = data.clasificacion ?? null;

    if (data.maquinaId) {
      const maquinaDb = await prisma.maquina.findUnique({
        where: { id: data.maquinaId },
        select: { planta: true, area: true }
      });

      if (!maquinaDb) {
        return res.status(404).json({ error: "La máquina especificada no existe." });
      }

      // La verdad absoluta de ubicación viene de la máquina — ignorar frontend
      finalPlanta = maquinaDb.planta;
      finalArea   = maquinaDb.area;

      // La clasificación es opcional; si se envía para tareas de maquinaria (mantenimiento), debe ser PREVENTIVO o CORRECTIVO
      if (finalClasificacion && finalClasificacion !== ClasificacionTarea.PREVENTIVO && finalClasificacion !== ClasificacionTarea.CORRECTIVO) {
        return res.status(400).json({
          error: "Para tareas de maquinaria (mantenimiento), la clasificación debe ser PREVENTIVO o CORRECTIVO."
        });
      }
    }

    const tieneResponsables = data.responsables && data.responsables.length > 0;

    if (tieneResponsables) {
      const usuariosAAsignar = await prisma.usuario.findMany({
        where: { id: { in: data.responsables }, estado: "ACTIVO" },
        select: { id: true, username: true }
      });

      if (usuariosAAsignar.length !== data.responsables!.length) {
        return res.status(400).json({ error: "Uno o más responsables no existen o están INACTIVOS." });
      }
    }

    // --- MOTOR DE COLISIONES Y ESTIMACIÓN DE TIEMPO ---
    let tiempoEstimado = data.tiempoEstimado || null;
    if (data.horaInicioProgramada && data.horaFinProgramada) {
      const inicio = new Date(data.horaInicioProgramada);
      const fin = new Date(data.horaFinProgramada);
      const minutosProgramados = calcularMinutosProgramadosMX(inicio, fin);
      if (minutosProgramados !== null) tiempoEstimado = minutosProgramados;

      if (tieneResponsables) {
        const overlapping = await prisma.tarea.findFirst({
          where: {
            responsables: { some: { id: { in: data.responsables } } },
            estado: { notIn: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA] },
            OR: [
              {
                horaInicioProgramada: { lt: fin },
                horaFinProgramada: { gt: inicio }
              }
            ]
          },
          select: { id: true, titulo: true }
        });

        if (overlapping) {
          return res.status(409).json({
            error: `Conflicto de Horario: Un técnico asignado ya tiene programada la tarea "${overlapping.titulo}" (ID: ${overlapping.id}) en ese intervalo.`
          });
        }
      }
    }

    const estadoInicial: EstadoTarea = tieneResponsables ? EstadoTarea.ASIGNADA : EstadoTarea.PENDIENTE;
    const responsablesConnect = tieneResponsables
      ? data.responsables!.map((id: number) => ({ id }))
      : [];

    const fechaVencimiento = data.fechaVencimiento ? new Date(data.fechaVencimiento) : null;

    const result = await prisma.$transaction(async (tx) => {
      const nuevaTarea = await tx.tarea.create({
        data: {
          titulo: data.titulo,
          descripcion: data.descripcion || "Sin descripción.",
          prioridad: data.prioridad,
          categoria: data.categoria,
          planta: finalPlanta,
          area: finalArea,
          clasificacion: finalClasificacion,   // Puede ser null — tarea de infraestructura
          tipo: data.tipo,
          estado: estadoInicial,
          fechaVencimiento,
          tiempoEstimado,
          creadorId: user.id,
          departamentoId: user.departamentoId,
          responsables: { connect: responsablesConnect },
          maquinaId: data.maquinaId ?? null,
          paroProduccion: data.paroProduccion,
          impactoProduccion: data.impactoProduccion ?? null,
          horaInicioProgramada: data.horaInicioProgramada ? new Date(data.horaInicioProgramada) : null,
          horaFinProgramada: data.horaFinProgramada ? new Date(data.horaFinProgramada) : null,
          refacciones: data.refacciones || null,
        }
      });

      const historial = await tx.historialTarea.create({
        data: {
          tareaId: nuevaTarea.id,
          usuarioId: user.id,
          tipo: TipoEvento.CREACION,
          estadoNuevo: estadoInicial,
          nota: data.maquinaId
            ? `Mantenimiento ${finalClasificacion ?? 'PREVENTIVO'} planificado en equipo.`
            : "Tarea de infraestructura creada."
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

      if (data.maquinaId && data.paroProduccion) {
        await tx.maquina.update({
          where: { id: data.maquinaId },
          data: { estado: "PARO_PRODUCCION" }
        });
      }

      return nuevaTarea;
    });

    if (data.responsables && data.responsables.length > 0) {
      void notificarAsignacionTarea(result, data.responsables);
    }

    await registrarAccion(
      "CREAR_TAREA_ADMIN",
      user.id,
      `Tarea creada ID: ${result.id} | Clasificación: ${finalClasificacion ?? 'SIN_CLASIFICACION'} | Tipo: ${data.tipo}`
    );

    return res.status(201).json({ message: "Tarea administrativa creada correctamente.", data: result });

  } catch (error) {
    await registrarError('CREATE_TICKET_ADMIN', user.id, error);
    return res.status(500).json({ error: "Error al guardar tarea administrativa" });
  }
};
