import { prisma } from "../../db";
import { EstadoTarea, TipoEvento } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { notificarCambioEstatus, notificarAdvertenciaTurno, notificarAutoPausa } from "../notificaciones/services";
import { getIO } from "../../utils/socket";

const DIAS_PARA_CIERRE_AUTOMATICO = 2;

export const autoCloseResolvedTickets = async () => {
  try {
    const ahora = new Date();
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - DIAS_PARA_CIERRE_AUTOMATICO);

    // Buscar tickets resueltos que excedan el tiempo límite
    const ticketsExpirados = await prisma.tarea.findMany({
      where: {
        estado: EstadoTarea.RESUELTO,
        finalizadoAt: {
          lt: fechaLimite
        }
      },
      include: { responsables: true }
    });

    if (ticketsExpirados.length === 0) return;

    for (const ticket of ticketsExpirados) {
      await prisma.$transaction(async (tx) => {
        const tareaActualizada = await tx.tarea.update({
          where: { id: ticket.id },
          data: { 
            estado: EstadoTarea.CERRADO,
            updatedAt: ahora
            // finalizadoAt ya existe desde que pasó a RESUELTO, no se toca.
          }
        });

        await tx.historialTarea.create({
          data: {
            tareaId: ticket.id,
            usuarioId: ticket.creadorId, // Atribuimos el cierre automático al creador (o usa un ID de sistema si lo tienes configurado)
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: EstadoTarea.RESUELTO,
            estadoNuevo: EstadoTarea.CERRADO,
            nota: "Tarea CERRADA de manera automática: Sin interacción del cliente por más de 2 días."
          }
        });

        return tareaActualizada;
      });

      // Notificar y registrar en bitácora de servidor fuera de la transacción
      void notificarCambioEstatus(ticket, EstadoTarea.CERRADO, ticket.creadorId);
      await registrarAccion(
        "CIERRE_AUTOMATICO",
        ticket.creadorId,
        `Ticket ${ticket.id}: RESUELTO → CERRADO por inactividad (> 2 días)`
      );
    }

} catch (error) {
    await registrarError("AUTO_CLOSE_TICKETS", 0, error);
  }
};

export const enviarAdvertenciasFinTurno = async () => {
  try {
    const tareasActivas = await prisma.tarea.findMany({
      where: { estado: EstadoTarea.EN_PROGRESO },
      include: { responsables: { select: { id: true } } }
    });

    if (tareasActivas.length === 0) return;

    const idsTecnicos = new Set<number>();
    tareasActivas.forEach(t => t.responsables.forEach(r => idsTecnicos.add(r.id)));

    if (idsTecnicos.size > 0) {
      await notificarAdvertenciaTurno(Array.from(idsTecnicos));
      await registrarAccion("CRON_ADVERTENCIA", 0, `Advertencia enviada a ${idsTecnicos.size} técnicos.`);
    }
  } catch (error) {
    await registrarError("CRON_ADVERTENCIA_FAIL", 0, error);
  }
};

export const ejecutarAutoPausaFinTurno = async () => {
  try {
    const ahora = new Date();
    const horaCorte = new Date(ahora);
    
    // Si es sábado (getDay() === 6), el turno oficial termina a las 14:00.
    // De lunes a viernes termina a las 17:30.
    if (ahora.getDay() === 6) {
      horaCorte.setHours(14, 0, 0, 0);
    } else {
      horaCorte.setHours(17, 30, 0, 0);
    }

    const tareasActivas = await prisma.tarea.findMany({
      where: { estado: EstadoTarea.EN_PROGRESO },
      include: { responsables: { select: { id: true } } }
    });

    if (tareasActivas.length === 0) return;

    const idsTecnicosNotificar = new Set<number>();

    for (const tarea of tareasActivas) {
      const intervaloAbierto = await prisma.intervaloTiempo.findFirst({
        where: { tareaId: tarea.id, fin: null },
        orderBy: { inicio: 'desc' }
      });

      if (!intervaloAbierto) continue;

      // REGLA DE RECORTE: Proteger horas extra, cortar tiempo fantasma
      const inicioMs = intervaloAbierto.inicio.getTime();
      const horaCorteMs = horaCorte.getTime();
      
      let finValidado: Date;
      if (inicioMs < horaCorteMs) {
        finValidado = horaCorte;
      } else {
        // Horas extra legítimas iniciadas después del corte oficial, pero dejadas activas.
        // Recortar a inicio (duración 0) para evitar tiempo fantasma nocturno.
        finValidado = new Date(inicioMs);
      }
      const duracionMin = Math.max(0, Math.floor((finValidado.getTime() - inicioMs) / 60000));

      await prisma.$transaction(async (tx) => {
        await tx.intervaloTiempo.update({
          where: { id: intervaloAbierto.id },
          data: { fin: finValidado, duracion: duracionMin }
        });

        await tx.tarea.update({
          where: { id: tarea.id },
          data: { 
            estado: EstadoTarea.EN_PAUSA,
            duracionReal: { increment: duracionMin }
          }
        });

        await tx.historialTarea.create({
          data: {
            tareaId: tarea.id,
            usuarioId: 1, // Usuario SISTEMA.
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: EstadoTarea.EN_PROGRESO,
            estadoNuevo: EstadoTarea.EN_PAUSA,
            nota: "⏸️ [SISTEMA] Tarea pausada automáticamente por fin de turno."
          }
        });
      });

      tarea.responsables.forEach(r => idsTecnicosNotificar.add(r.id));
    }

    if (idsTecnicosNotificar.size > 0) {
      await notificarAutoPausa(Array.from(idsTecnicosNotificar));
      await registrarAccion("CRON_AUTOPAUSA", 0, `Auto-Pausa aplicada a ${tareasActivas.length} tareas.`);
      try {
        const io = getIO();
        io.to("global_updates").emit("datos_actualizados", { module: "tickets" });
      } catch (_) {}
    }

  } catch (error) {
    await registrarError("CRON_AUTOPAUSA_FAIL", 0, error);
  }
};