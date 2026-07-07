// src/modules/recurrencias/03_update.ts
// PUT /api/recurrencias/:id
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea } from "@prisma/client";
import type { UpdateReglaInput } from "./zod";
import { normalizarFechaLogica } from "./helper";

// Estados de un ticket que NO deben ser modificados al actualizar la regla
// (tickets históricos o activos que ya están en ejecución)
const ESTADOS_INTOCABLES: EstadoTarea[] = [
  EstadoTarea.EN_PROGRESO,
  EstadoTarea.EN_PAUSA,
  EstadoTarea.RESUELTO,
  EstadoTarea.CERRADO,
  EstadoTarea.CANCELADA,
];

export const updateRegla = async (req: Request, res: Response) => {
  try {
    const id   = Number(req.params.id);
    const body = req.body as UpdateReglaInput;

    // --- 1. Verificar que la regla existe ---
    const reglaActual = await prisma.reglaRecurrencia.findUnique({
      where: { id },
      select: {
        id: true,
        maquinaId: true,
        frecuencia: true,
        intervaloDias: true,
        tecnicoResponsableId: true,
        proximaFechaEjecucion: true,
      },
    });
    if (!reglaActual) {
      return res.status(404).json({ error: "Regla de recurrencia no encontrada" });
    }

    // --- 2. Validar técnico si se está cambiando ---
    if (body.tecnicoResponsableId != null) {
      const tecnico = await prisma.usuario.findUnique({
        where: { id: body.tecnicoResponsableId },
        select: { id: true, estado: true },
      });
      if (!tecnico) return res.status(400).json({ error: "El técnico especificado no existe" });
      if (tecnico.estado !== "ACTIVO") return res.status(400).json({ error: "El técnico no está activo" });
    }

    // --- 3. Normalizar nueva fecha si viene ---
    const nuevaFechaLogica = body.proximaFechaEjecucion
      ? normalizarFechaLogica(body.proximaFechaEjecucion)
      : undefined;

    // --- 4. Actualizar la regla ---
    const reglaActualizada = await prisma.reglaRecurrencia.update({
      where: { id },
      data: {
        ...(body.titulo               !== undefined && { titulo: body.titulo }),
        ...(body.descripcion          !== undefined && { descripcion: body.descripcion }),
        ...(body.categoria            !== undefined && { categoria: body.categoria }),
        ...(body.prioridad            !== undefined && { prioridad: body.prioridad }),
        ...(body.tiempoEstimado       !== undefined && { tiempoEstimado: body.tiempoEstimado }),
        ...(body.frecuencia           !== undefined && { frecuencia: body.frecuencia }),
        ...(body.intervaloDias        !== undefined && { intervaloDias: body.intervaloDias }),
        ...(body.tecnicoResponsableId !== undefined && { tecnicoResponsableId: body.tecnicoResponsableId }),
        ...(nuevaFechaLogica          !== undefined && { proximaFechaEjecucion: nuevaFechaLogica }),
        ...(body.activo               !== undefined && { activo: body.activo }),
      },
      include: {
        maquina:            { select: { id: true, codigo: true, nombre: true, planta: true, area: true } },
        tecnicoResponsable: { select: { id: true, nombre: true, username: true, email: true } },
      },
    });

    // --- 5. Sincronizar ticket pendiente futuro ---
    // Solo tocar el ticket cuyo estado sea PENDIENTE o ASIGNADA
    // (no inicado ni histórico). Se busca por reglaRecurrenciaId + fechaCicloLogica >= hoy.
    const hoy = normalizarFechaLogica(new Date());
    const ticketPendiente = await prisma.tarea.findFirst({
      where: {
        reglaRecurrenciaId: id,
        fechaCicloLogica:   { gte: hoy },
        estado:             { notIn: ESTADOS_INTOCABLES },
      },
      orderBy: { fechaCicloLogica: "asc" },
    });

    let ticketSincronizado = null;
    if (ticketPendiente) {
      const updateData: Record<string, any> = {};

      if (body.titulo               !== undefined) updateData.titulo          = body.titulo;
      if (body.descripcion          !== undefined) updateData.descripcion     = body.descripcion;
      if (body.prioridad            !== undefined) updateData.prioridad       = body.prioridad;
      if (body.tiempoEstimado       !== undefined) updateData.tiempoEstimado  = body.tiempoEstimado;

      // Si se cambia el técnico, actualizar los responsables del ticket pendiente
      if (body.tecnicoResponsableId !== undefined) {
        await prisma.tarea.update({
          where: { id: ticketPendiente.id },
          data: {
            responsables: {
              // Reemplazar el responsable anterior por el nuevo
              set: [{ id: body.tecnicoResponsableId }],
            },
          },
        });
      }

      if (Object.keys(updateData).length > 0) {
        ticketSincronizado = await prisma.tarea.update({
          where: { id: ticketPendiente.id },
          data: updateData,
          select: { id: true, titulo: true, estado: true, fechaCicloLogica: true },
        });
      } else if (body.tecnicoResponsableId !== undefined) {
        ticketSincronizado = { id: ticketPendiente.id, titulo: ticketPendiente.titulo, estado: ticketPendiente.estado, fechaCicloLogica: ticketPendiente.fechaCicloLogica };
      }
    }

    return res.json({
      regla: reglaActualizada,
      ticketSincronizado,
      mensaje: ticketSincronizado
        ? "Regla actualizada y ticket pendiente sincronizado"
        : "Regla actualizada (sin ticket pendiente que sincronizar)",
    });
  } catch (error) {
    console.error("[recurrencias] updateRegla error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
