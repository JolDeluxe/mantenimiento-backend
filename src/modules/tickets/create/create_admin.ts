// src/modules/tickets/create/create_admin.ts
import type { Request, Response } from "express";
import { prisma } from "../../../db"; 
import { createTicketAdminSchema } from "../zod";
import { EstadoTarea, TipoEvento, Rol, TipoTarea, ClasificacionTarea, Prioridad } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { processTicketImages } from "./helper_upload";
import { notificarAsignacionTarea } from "../../notificaciones/services";

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
        return res.status(400).json({ error: "Los administradores solo pueden crear tareas PLANEADAS o EXTRAORDINARIAS." });
    }

    const tieneResponsables = data.responsables && data.responsables.length > 0;
    
    if (data.clasificacion === ClasificacionTarea.INSPECCION && !tieneResponsables) {
        return res.status(400).json({ error: "Las tareas de INSPECCIÓN deben tener un responsable asignado obligatoriamente." });
    }

    let nombresAsignados = ""; // <-- Declaramos variable para guardar nombres

    if (tieneResponsables) {
        const usuariosAAsignar = await prisma.usuario.findMany({
            where: { id: { in: data.responsables }, estado: "ACTIVO" },
            select: { id: true, rol: true, username: true }
        });

        nombresAsignados = usuariosAAsignar.map(u => u.username).join(', '); // <-- Extraemos los nombres
        
        if (usuariosAAsignar.length !== data.responsables!.length) {
            return res.status(400).json({ error: "Uno o más responsables no existen o están INACTIVOS." });
        }
    }

    let estadoInicial: EstadoTarea = EstadoTarea.PENDIENTE;
    let responsablesConnect: { id: number }[] = [];

    if (tieneResponsables) {
        responsablesConnect = data.responsables!.map((id) => ({ id }));
        estadoInicial = EstadoTarea.ASIGNADA; 
    }

    let fechaVencimiento: Date | null = null;
    if (data.fechaVencimiento) {
        fechaVencimiento = new Date(data.fechaVencimiento);
    }

    const result = await prisma.$transaction(async (tx) => {
      const nuevaTarea = await tx.tarea.create({
        data: {
          titulo: data.titulo,
          descripcion: data.descripcion || "Sin descripción.",
          prioridad: data.prioridad,
          categoria: data.categoria,
          planta: data.planta || "KAPPA",
          area: data.area || "General",
          clasificacion: data.clasificacion || (data.categoria === 'RUTINA' ? ClasificacionTarea.RUTINA : ClasificacionTarea.PREVENTIVO),
          tipo: data.tipo,
          estado: estadoInicial,
          fechaVencimiento,
          tiempoEstimado: data.tiempoEstimado || null,
          creadorId: user.id,
          departamentoId: user.departamentoId,
          responsables: { connect: responsablesConnect }
        }
      });

      const historial = await tx.historialTarea.create({
        data: {
          tareaId: nuevaTarea.id,
          usuarioId: user.id,
          tipo: TipoEvento.CREACION, 
          estadoNuevo: estadoInicial,
          nota: tieneResponsables ? `Tarea creada y asignada a: ${nombresAsignados}` : "Tarea planeada creada (Pendiente)"
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

    if (data.responsables && data.responsables.length > 0) {
        void notificarAsignacionTarea(result, data.responsables);
    }

    await registrarAccion("CREAR_TAREA_ADMIN", user.id, `Tarea creada ID: ${result.id} | Título: ${result.titulo}`);
    return res.status(201).json({ message: "Tarea administrativa creada correctamente.", data: result });

  } catch (error) {
    await registrarError('CREATE_TICKET_ADMIN', user.id, error);
    return res.status(500).json({ error: "Error al guardar tarea administrativa" });
  }
};