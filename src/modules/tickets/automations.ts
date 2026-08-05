import { prisma } from "../../db";
import { EstadoTarea, TipoEvento } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { notificarCambioEstatus, notificarAdvertenciaTurno, notificarAutoPausa } from "../notificaciones/services";
import { getIO } from "../../utils/socket";
import { getFinOficialTurno, getTipoJornadaTurno, type TipoJornadaTurno } from "./turno-config";

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

    // Obtener usuario sistema dinámicamente como fallback
    let systemUser = await prisma.usuario.findUnique({
      where: { username: process.env.SYS_ADMIN_USER || "SUPER_ADMIN" }
    });
    if (!systemUser) {
      systemUser = await prisma.usuario.findFirst({
        where: { rol: "SUPER_ADMIN", estado: "ACTIVO" }
      });
    }
    const fallbackUserId = systemUser?.id;

    let evaluados = ticketsExpirados.length;
    let cerrados = 0;
    let omitidos = 0;
    let conError = 0;

    for (const ticket of ticketsExpirados) {
      try {
        // Validar si el creador original sigue existiendo en BD
        let actorId = ticket.creadorId;
        const creadorExiste = await prisma.usuario.findUnique({ where: { id: actorId } });
        
        if (!creadorExiste) {
          if (fallbackUserId) {
             actorId = fallbackUserId;
          } else {
             omitidos++;
             await registrarError("AUTO_CLOSE_TICKETS_OMITIDO", null, `Ticket ${ticket.id} omitido: creador inexistente y no hay SUPER_ADMIN.`);
             continue;
          }
        }

        await prisma.$transaction(async (tx) => {
          const tareaActualizada = await tx.tarea.update({
            where: { id: ticket.id },
            data: { 
              estado: EstadoTarea.CERRADO,
              updatedAt: ahora
            }
          });

          await tx.historialTarea.create({
            data: {
              tareaId: ticket.id,
              usuarioId: actorId, 
              tipo: TipoEvento.CAMBIO_ESTADO,
              estadoAnterior: EstadoTarea.RESUELTO,
              estadoNuevo: EstadoTarea.CERRADO,
              nota: "Tarea CERRADA de manera automática: Sin interacción del cliente por más de 2 días." + (!creadorExiste ? " (Atribuido a SISTEMA por usuario original no encontrado)." : "")
            }
          });

          return tareaActualizada;
        });

        // Notificar y registrar en bitácora de servidor fuera de la transacción
        void notificarCambioEstatus(ticket, EstadoTarea.CERRADO, actorId);
        await registrarAccion(
          "CIERRE_AUTOMATICO",
          null,
          `Ticket ${ticket.id}: RESUELTO → CERRADO por inactividad (> 2 días)`
        );
        cerrados++;
      } catch (err) {
        conError++;
        await registrarError(`AUTO_CLOSE_TICKET_${ticket.id}_FAIL`, null, err);
      }
    }

    await registrarAccion(
      "AUTO_CLOSE_TICKETS_RESUMEN", 
      null, 
      `Evaluación finalizada. Evaluados: ${evaluados}. Cerrados: ${cerrados}. Omitidos: ${omitidos}. Errores: ${conError}.`
    );

  } catch (error) {
    await registrarError("AUTO_CLOSE_TICKETS", null, error);
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
      await registrarAccion("CRON_ADVERTENCIA", null, `Advertencia enviada a ${idsTecnicos.size} técnicos.`);
    }
  } catch (error) {
    await registrarError("CRON_ADVERTENCIA_FAIL", null, error);
  }
};

interface AutoPausaFinTurnoOptions {
  ahora?: Date;
  tipoJornada?: TipoJornadaTurno;
}

export const calcularFinAutoPausaIntervalo = (inicio: Date, ahora: Date, finOficial: Date) => {
  if (inicio.getTime() < finOficial.getTime()) {
    return {
      fin: finOficial,
      advertencia: null as string | null,
    };
  }

  return {
    fin: ahora,
    advertencia: "INTERVALO_INICIADO_FUERA_DE_TURNO",
  };
};

export const ejecutarAutoPausaFinTurno = async (options: AutoPausaFinTurnoOptions = {}) => {
  try {
    const ahora = options.ahora ?? new Date();
    const tipoJornada = options.tipoJornada ?? getTipoJornadaTurno(ahora);

    if (!tipoJornada) {
      await registrarAccion("CRON_AUTOPAUSA_OMITIDA", null, "Auto-pausa omitida: no hay jornada ordinaria para la fecha local.");
      return;
    }

    const horaCorte = getFinOficialTurno(ahora, tipoJornada);
    if (!horaCorte) {
      await registrarAccion("CRON_AUTOPAUSA_OMITIDA", null, "Auto-pausa omitida: no se pudo resolver fin oficial de turno.");
      return;
    }

    const tareasActivas = await prisma.tarea.findMany({
      where: { estado: EstadoTarea.EN_PROGRESO },
      include: { responsables: { select: { id: true } } }
    });

    if (tareasActivas.length === 0) return;

    let systemUser = await prisma.usuario.findUnique({
      where: { username: process.env.SYS_ADMIN_USER || "SUPER_ADMIN" }
    });
    if (!systemUser) {
      systemUser = await prisma.usuario.findFirst({
        where: { rol: "SUPER_ADMIN", estado: "ACTIVO" }
      });
    }
    const fallbackUserId = systemUser?.id;
    if (!fallbackUserId) {
        await registrarError("CRON_AUTOPAUSA_FAIL", null, "No se encontró un usuario SISTEMA válido para realizar la pausa.");
        return;
    }

    const idsTecnicosNotificar = new Set<number>();
    let pausadas = 0;
    let sinIntervalo = 0;
    let fueraDeTurno = 0;

    for (const tarea of tareasActivas) {
      const intervalosAbiertos = await prisma.intervaloTiempo.findMany({
        where: { tareaId: tarea.id, fin: null },
        orderBy: { inicio: "asc" }
      });

      const cierres = intervalosAbiertos.map((intervalo) => {
        const { fin, advertencia } = calcularFinAutoPausaIntervalo(intervalo.inicio, ahora, horaCorte);
        const duracionMin = Math.max(0, Math.floor((fin.getTime() - intervalo.inicio.getTime()) / 60000));
        return { intervalo, fin, duracionMin, advertencia };
      });

      const duracionTotal = cierres.reduce((acc, cierre) => acc + cierre.duracionMin, 0);
      const advertencias = new Set<string>();
      cierres.forEach((cierre) => {
        if (cierre.advertencia) advertencias.add(cierre.advertencia);
      });
      if (intervalosAbiertos.length === 0) {
        advertencias.add("TAREA_EN_PROGRESO_SIN_INTERVALO");
        sinIntervalo++;
      }
      if (advertencias.has("INTERVALO_INICIADO_FUERA_DE_TURNO")) fueraDeTurno++;

      await prisma.$transaction(async (tx) => {
        for (const cierre of cierres) {
          await tx.intervaloTiempo.update({
            where: { id: cierre.intervalo.id },
            data: { fin: cierre.fin, duracion: cierre.duracionMin }
          });
        }

        await tx.tarea.update({
          where: { id: tarea.id },
          data: { 
            estado: EstadoTarea.EN_PAUSA,
            ...(duracionTotal > 0 ? { duracionReal: { increment: duracionTotal } } : {})
          }
        });

        await tx.historialTarea.create({
          data: {
            tareaId: tarea.id,
            usuarioId: fallbackUserId, // Usuario SISTEMA validado dinámicamente
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: EstadoTarea.EN_PROGRESO,
            estadoNuevo: EstadoTarea.EN_PAUSA,
            nota: [
              "[SISTEMA_FIN_TURNO] Tarea pausada automáticamente por fin de turno.",
              `Corte oficial: ${horaCorte.toISOString()}.`,
              `Ejecución: ${ahora.toISOString()}.`,
              advertencias.size > 0 ? `Advertencias: ${Array.from(advertencias).join(", ")}.` : null,
            ].filter(Boolean).join(" ")
          }
        });
      });

      tarea.responsables.forEach(r => idsTecnicosNotificar.add(r.id));
      pausadas++;

      if (advertencias.size > 0) {
        await registrarAccion(
          "CRON_AUTOPAUSA_ADVERTENCIA",
          fallbackUserId,
          `Ticket ${tarea.id}: ${Array.from(advertencias).join(", ")}`
        );
      }
    }

    if (idsTecnicosNotificar.size > 0) {
      await notificarAutoPausa(Array.from(idsTecnicosNotificar));
      await registrarAccion(
        "CRON_AUTOPAUSA",
        null,
        `Auto-pausa aplicada a ${pausadas} tareas. Sin intervalo: ${sinIntervalo}. Fuera de turno: ${fueraDeTurno}.`
      );
      try {
        const io = getIO();
        io.to("global_updates").emit("datos_actualizados", { module: "tickets" });
      } catch (_) {}
    }

  } catch (error) {
    await registrarError("CRON_AUTOPAUSA_FAIL", null, error);
  }
};
