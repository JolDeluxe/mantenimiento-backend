import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { calcularMinutosProgramadosMX } from "../helper";
import { crearFallaProvisional } from "../../bi_maquinaria/services/confirmacion_falla_service";
import { recalcularEstadoMaquina } from "../../maquinas/helper";
import { uploadTaskImage } from "../../../utils/cloudinary";

export const createBatchTickets = async (req: Request, res: Response) => {
  const user = req.user!;
  const { tareas } = req.body;

  try {
    // ── GESTIÓN DE IMÁGENES / ARCHIVOS EN BATCH ─────────────────────────────
    const filesByTaskIndex = new Map<number, Express.Multer.File[]>();
    const totalArchivos = req.files && Array.isArray(req.files) ? req.files.length : 0;
    console.log(`[CREATE_BATCH] ${tareas.length} tareas recibidas. Archivos detectados por Multer: ${totalArchivos}`);

    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        const match = file.fieldname.match(/^imagenes_(\d+)$/);
        if (match && match[1]) {
          const idx = parseInt(match[1], 10);
          const list = filesByTaskIndex.get(idx) || [];
          list.push(file);
          filesByTaskIndex.set(idx, list);
        }
      }
    }

    if (filesByTaskIndex.size > 0) {
      console.log(`[CREATE_BATCH] Tareas con imágenes asignadas (${filesByTaskIndex.size}):`, Array.from(filesByTaskIndex.entries()).map(([k, v]) => `Tarea #${k + 1}: ${v.length} fotos`).join(', '));
    }

    // Regla de negocio 1: Máximo 10 tareas con fotos por lote
    if (filesByTaskIndex.size > 10) {
      return res.status(400).json({
        error: "Se excedió el límite permitido: máximo 10 tareas de un mismo lote pueden incluir imágenes."
      });
    }

    // Validar índices de tarea
    for (const idx of filesByTaskIndex.keys()) {
      if (idx < 0 || idx >= tareas.length) {
        return res.status(400).json({
          error: `Índice de tarea inválido para las imágenes asociadas: ${idx}.`
        });
      }
    }

    // Validar máximo 3 imágenes por tarea
    for (const [idx, files] of filesByTaskIndex.entries()) {
      if (files.length > 3) {
        return res.status(400).json({
          error: `La tarea #${idx + 1} excede el límite máximo de 3 imágenes permitidas.`
        });
      }
    }

    // Regla de negocio 2: Subida paralela tolerante a fallos con Promise.allSettled
    // Se ejecuta ANTES de abrir la transacción de base de datos
    type UploadItem = {
      taskIndex: number;
      tareaTitulo: string;
      file: Express.Multer.File;
    };

    const uploadItems: UploadItem[] = [];
    for (const [taskIndex, files] of filesByTaskIndex.entries()) {
      const tareaTitulo = tareas[taskIndex]?.titulo || `Índice ${taskIndex}`;
      for (const file of files) {
        uploadItems.push({ taskIndex, tareaTitulo, file });
      }
    }

    const uploadPromises = uploadItems.map(async ({ taskIndex, tareaTitulo, file }) => {
      try {
        const url = await uploadTaskImage({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
        });
        console.log(`[CREATE_BATCH] Imagen "${file.originalname}" subida a Cloudinary para tarea #${taskIndex + 1}: ${url}`);
        return { taskIndex, originalname: file.originalname, url };
      } catch (error) {
        console.error(`[CREATE_BATCH] Falló subida de imagen "${file.originalname}" para tarea #${taskIndex + 1} ("${tareaTitulo}"):`, error);
        await registrarError(
          "CREATE_BATCH_IMAGE_UPLOAD",
          user.id,
          new Error(`Fallo al subir imagen "${file.originalname}" de tarea #${taskIndex + 1} ("${tareaTitulo}"): ${error instanceof Error ? error.message : String(error)}`)
        );
        throw error;
      }
    });

    const uploadResults = await Promise.allSettled(uploadPromises);

    const urlsByTaskIndex = new Map<number, string[]>();
    for (const result of uploadResults) {
      if (result.status === "fulfilled") {
        const { taskIndex, url } = result.value;
        const list = urlsByTaskIndex.get(taskIndex) || [];
        list.push(url);
        urlsByTaskIndex.set(taskIndex, list);
      }
    }

    // ── PRE-CARGA: Resolver ubicaciones de máquinas antes de la transacción ──
    // Evita N queries dentro del loop y garantiza consistencia del Snapshot
    const maquinaIdsUnicos = [
      ...new Set(tareas.map((t: any) => t.maquinaId).filter(Boolean))
    ] as number[];

    const maquinasMap = new Map<number, { planta: string | null; area: string | null }>();

    if (maquinaIdsUnicos.length > 0) {
      const maquinas = await prisma.maquina.findMany({
        where: { id: { in: maquinaIdsUnicos } },
        select: { id: true, planta: true, area: true }
      });
      maquinas.forEach(m => maquinasMap.set(m.id, { planta: m.planta, area: m.area }));
    }

    const results = await prisma.$transaction(async (tx) => {
      const ticketsCreados: { id: number; titulo: string }[] = [];

      for (let i = 0; i < tareas.length; i++) {
        const tarea = tareas[i];
        const tieneResponsables = tarea.responsables && tarea.responsables.length > 0;
        const estadoInicial = tieneResponsables ? EstadoTarea.ASIGNADA : EstadoTarea.PENDIENTE;

        // ── SNAPSHOT: La ubicación de la máquina siempre gana ────────────────
        let finalPlanta: string | null = tarea.planta ?? null;
        let finalArea: string | null = tarea.area || "General";
        let clasificacionFinal: ClasificacionTarea | null = null;

        if (tarea.maquinaId && maquinasMap.has(tarea.maquinaId)) {
          const ubicMaquina = maquinasMap.get(tarea.maquinaId)!;
          finalPlanta = ubicMaquina.planta;
          finalArea   = ubicMaquina.area;
          // Respetar clasificación enviada; si no hay, guardar como null (hacer opcional)
          clasificacionFinal = tarea.clasificacion
            ? (tarea.clasificacion as ClasificacionTarea)
            : null;
        } else if (tarea.clasificacion) {
          // Sin máquina pero con clasificación explícita (ej: infraestructura general)
          clasificacionFinal = tarea.clasificacion as ClasificacionTarea;
        }
        // Sin maquinaId and sin clasificacion → null (tarea de infraestructura genérica)

        const responsablesConnect = tieneResponsables
          ? tarea.responsables.map((id: number) => ({ id }))
          : [];

        const horaInicioProgramada = tarea.horaInicioProgramada ? new Date(tarea.horaInicioProgramada) : null;
        const horaFinProgramada = tarea.horaFinProgramada ? new Date(tarea.horaFinProgramada) : null;
        let tiempoEstimado = tarea.tiempoEstimado || null;
        if (horaInicioProgramada && horaFinProgramada) {
          const minutosProgramados = calcularMinutosProgramadosMX(horaInicioProgramada, horaFinProgramada);
          if (minutosProgramados !== null) tiempoEstimado = minutosProgramados;
        }

        const nuevoTicket = await tx.tarea.create({
          data: {
            titulo: tarea.titulo,
            descripcion: tarea.descripcion || "Sin descripción.",
            planta: finalPlanta,
            area: finalArea,
            categoria: tarea.categoria,
            tipo: tarea.tipo,
            clasificacion: clasificacionFinal,
            prioridad: tarea.prioridad,
            tiempoEstimado,
            estado: estadoInicial,
            fechaVencimiento: tarea.fechaVencimiento ?? null,
            horaInicioProgramada,
            horaFinProgramada,
            creadorId: user.id,
            departamentoId: tarea.departamentoId ?? user.departamentoId,
            responsables: { connect: responsablesConnect },
            maquinaId: tarea.maquinaId ?? null,
            paroProduccion: tarea.paroProduccion ?? false,
            impactoProduccion: tarea.impactoProduccion ?? null,
          },
        });

        const historial = await tx.historialTarea.create({
          data: {
            tareaId: nuevoTicket.id,
            usuarioId: user.id,
            tipo: TipoEvento.CREACION,
            estadoNuevo: estadoInicial,
            nota: tarea.maquinaId
              ? `Mantenimiento en equipo — inserción masiva.`
              : "Tarea registrada mediante inserción masiva (Batch)."
          }
        });

        // Adjuntar imágenes que se hayan subido exitosamente para esta tarea
        const urlsImagenes = urlsByTaskIndex.get(i) || [];
        if (urlsImagenes.length > 0) {
          await tx.imagen.createMany({
            data: urlsImagenes.map((url) => ({
              url,
              tipo: "EVIDENCIA_INICIAL",
              tareaId: nuevoTicket.id,
              historialId: historial.id,
            })),
          });
        }

        // BI MAQUINARIA FASE 1: Falla provisional
        if (clasificacionFinal === ClasificacionTarea.CORRECTIVO && nuevoTicket.maquinaId) {
          await crearFallaProvisional(tx, {
            tareaId: nuevoTicket.id,
            maquinaId: nuevoTicket.maquinaId,
            fechaFallaReportada: nuevoTicket.createdAt,
          });
        }

        if (tarea.maquinaId) {
          await recalcularEstadoMaquina(tarea.maquinaId, tx, {
            tareaId: nuevoTicket.id,
            nuevoEstado: EstadoTarea.PENDIENTE,
            paroProduccion: tarea.paroProduccion
          });
        }

        ticketsCreados.push({ id: nuevoTicket.id, titulo: nuevoTicket.titulo });
      }

      return ticketsCreados;
    });

    await registrarAccion(
      "CREAR_BATCH_ADMIN",
      user.id,
      `Se crearon ${results.length} tareas masivas.`
    );

    return res.status(201).json({
      message: `${results.length} tareas creadas exitosamente.`,
      ids: results.map(r => r.id)
    });

  } catch (error) {
    await registrarError('CREATE_BATCH_ADMIN', user.id, error);
    return res.status(500).json({ error: "Error al procesar el lote de tareas." });
  }
};
