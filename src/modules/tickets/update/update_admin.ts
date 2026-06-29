// update/update_admin.ts
// Lógica completa de edición para roles ADMIN / JEFE_MTTO / COORDINADOR_MTTO.
// Regla Zod estricta: si vienen horaInicioProgramada + horaFinProgramada,
// se calcula tiempoEstimado en minutos bajo timezone America/Mexico_City.
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento, Rol } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { processTicketImages } from "../create/helper_upload";
import { deleteImageByUrl } from "../../../utils/cloudinary";
import { notificarAsignacionTarea, notificarModificacionTarea } from "../../notificaciones/services";
import type { UpdateTicketParams, UpdateTicketInput } from "../zod";

// ─── Utilidad timezone Mexico_City ───────────────────────────────────────────
// Convierte un Date UTC a un Date equivalente en hora local MX para cálculos
// de duración correctos (evita problemas de DST al comparar getTime()).
const toMXDate = (iso: string | Date): Date => {
  const raw = typeof iso === "string" ? new Date(iso) : iso;
  // Usamos la diferencia entre la hora en MX y UTC para normalizar.
  const mxStr = raw.toLocaleString("en-CA", {
    timeZone: "America/Mexico_City",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  // mxStr: "YYYY-MM-DD, HH:MM:SS"
  return new Date(mxStr.replace(", ", "T"));
};

const calcularMinutosMX = (inicio: Date, fin: Date): number => {
  const mxInicio = toMXDate(inicio);
  const mxFin    = toMXDate(fin);
  const diffMs   = mxFin.getTime() - mxInicio.getTime();
  return Math.max(1, Math.floor(diffMs / 60000));
};

export const updateTicketAdmin = async (req: Request, res: Response) => {
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

    // ─── Responsables ────────────────────────────────────────────────────────
    let nuevoEstado          = tareaActual.estado;
    let cambioDeResponsables = false;
    let idsResponsables: { id: number }[] | undefined = undefined;
    let nombresAsignadosStr  = "";

    if (data.responsables !== undefined) {
      cambioDeResponsables = true;
      if (data.responsables.length > 0) {
        const usuariosActivos = await prisma.usuario.findMany({
          where: { id: { in: data.responsables }, estado: "ACTIVO" },
          select: { id: true, nombre: true }
        });
        if (usuariosActivos.length !== data.responsables.length) {
          return res.status(400).json({ error: "Responsables inválidos o inactivos." });
        }
        nombresAsignadosStr = usuariosActivos.map(u => u.nombre).join(", ");
      }
      idsResponsables = data.responsables.map(id => ({ id }));

      if (tareaActual.estado === EstadoTarea.PENDIENTE || tareaActual.estado === EstadoTarea.ASIGNADA) {
        nuevoEstado = data.responsables.length > 0 ? EstadoTarea.ASIGNADA : EstadoTarea.PENDIENTE;
      }
    }

    // ─── Fecha vencimiento ────────────────────────────────────────────────────
    let nuevaFechaVencimiento: Date | undefined = undefined;
    if (data.fechaVencimiento) {
      const fecha = new Date(data.fechaVencimiento);
      fecha.setHours(23, 59, 59, 999);
      nuevaFechaVencimiento = fecha;
    }

    // ─── Tiempo estimado (Regla estricta Mexico_City) ─────────────────────────
    // Prioridad: payload explícito > derivado de horas > valor previo
    let finalHoraInicio = data.horaInicioProgramada !== undefined
      ? (data.horaInicioProgramada ? new Date(data.horaInicioProgramada) : null)
      : tareaActual.horaInicioProgramada;
    let finalHoraFin = data.horaFinProgramada !== undefined
      ? (data.horaFinProgramada ? new Date(data.horaFinProgramada) : null)
      : tareaActual.horaFinProgramada;

    let tiempoEstimado: number | null | undefined =
      data.tiempoEstimado !== undefined ? data.tiempoEstimado : (tareaActual.tiempoEstimado || null);

    // Si vienen ambas horas → calcular automáticamente bajo MX timezone
    if (finalHoraInicio && finalHoraFin) {
      if (finalHoraFin > finalHoraInicio) {
        tiempoEstimado = calcularMinutosMX(finalHoraInicio, finalHoraFin);
      }

      // Validar colisión de horario con otros responsables
      const finalResponsables = data.responsables !== undefined
        ? data.responsables
        : tareaActual.responsables.map(r => r.id);

      if (finalResponsables.length > 0) {
        const overlapping = await prisma.tarea.findFirst({
          where: {
            id: { not: ticketId },
            responsables: { some: { id: { in: finalResponsables } } },
            estado: { notIn: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA] },
            OR: [{
              horaInicioProgramada: { lt: finalHoraFin },
              horaFinProgramada:    { gt: finalHoraInicio }
            }]
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

    // ─── Máquina / Planta / Área ──────────────────────────────────────────────
    const categoriaFinal = data.categoria !== undefined ? data.categoria : tareaActual.categoria;
    let finalMaquinaId   = data.maquinaId !== undefined ? data.maquinaId : tareaActual.maquinaId;
    let finalPlanta      = data.planta !== undefined ? data.planta : tareaActual.planta;
    let finalArea        = data.area   !== undefined ? data.area   : tareaActual.area;

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
          titulo:               data.titulo       ?? undefined,
          descripcion:          data.descripcion  ?? undefined,
          categoria:            data.categoria    ?? undefined,
          planta:               finalPlanta,
          area:                 finalArea,
          maquinaId:            finalMaquinaId,
          paroProduccion:       data.paroProduccion,
          impactoProduccion:    data.impactoProduccion,
          prioridad:            data.prioridad    ?? undefined,
          fechaVencimiento:     nuevaFechaVencimiento,
          tiempoEstimado:       tiempoEstimado ?? undefined,
          estado:               nuevoEstado,
          responsables:         idsResponsables ? { set: idsResponsables } : undefined,
          tipo:                 data.tipo         ?? undefined,
          clasificacion:        data.clasificacion ?? undefined,
          horaInicioProgramada: data.horaInicioProgramada !== undefined
            ? (data.horaInicioProgramada ? new Date(data.horaInicioProgramada) : null)
            : undefined,
          horaFinProgramada:    data.horaFinProgramada !== undefined
            ? (data.horaFinProgramada ? new Date(data.horaFinProgramada) : null)
            : undefined,
          refacciones:          data.refacciones !== undefined ? data.refacciones : undefined,
        },
        include: { responsables: true }
      });

      const notasCambio: string[] = [];
      if (cambioDeResponsables) {
        notasCambio.push(data.responsables!.length > 0
          ? `Asignado a: ${nombresAsignadosStr}`
          : "Se retiraron técnicos");
      }
      if (nuevoEstado !== tareaActual.estado)
        notasCambio.push(`Estado: ${nuevoEstado}`);
      if (data.prioridad && data.prioridad !== tareaActual.prioridad)
        notasCambio.push(`Prioridad: ${data.prioridad}`);
      if (data.fechaVencimiento)
        notasCambio.push("Se actualizó fecha vencimiento");
      if (tiempoEstimado && tiempoEstimado !== tareaActual.tiempoEstimado)
        notasCambio.push(`Tiempo estimado: ${tiempoEstimado} min`);

      if (notasCambio.length > 0 || (data.imagenes && data.imagenes.length > 0)) {
        const historial = await tx.historialTarea.create({
          data: {
            tareaId:        ticketId,
            usuarioId:      user.id,
            tipo:           TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: tareaActual.estado,
            estadoNuevo:    nuevoEstado,
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

    if (cambioDeResponsables && data.responsables && data.responsables.length > 0) {
      void notificarAsignacionTarea(result, data.responsables);
    } else if (!cambioDeResponsables) {
      void notificarModificacionTarea(result, user.id);
    }

    await registrarAccion("UPDATE_TAREA", user.id, `Actualización Tarea ID: ${ticketId}. Usuario: ${user.email}`);
    return res.json({ message: "Actualización correcta", data: result });

  } catch (error) {
    await registrarError("UPDATE_TICKET_ADMIN", user.id, error);
    return res.status(500).json({ error: "Error al actualizar la tarea" });
  }
};
