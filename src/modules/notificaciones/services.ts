import { enviarNotificacionPush }    from "./helper";
import { obtenerIdsPorRol }          from "../usuarios/helper";
import { Rol, EstadoTarea, TipoNotificacion } from "@prisma/client";
import type { Tarea, Usuario }       from "@prisma/client";
import { registrarError }            from "../../utils/logger";
import { prisma }                    from "../../db";
import type { PayloadBase, TareaConRelaciones } from "./types";

const distribuirNotificacion = async (
  idsDestinatarios: number[],
  payload: PayloadBase
) => {
  const uniqueIds = [...new Set(idsDestinatarios)].filter((id) => id > 0);
  if (uniqueIds.length === 0) return;

  const dataPush = {
    title: payload.titulo,
    body:  payload.cuerpo,
    url:   payload.url,
    icon:  "/img/icon-192.png",
  };

  const resultados = await Promise.allSettled(
    uniqueIds.map((id) => enviarNotificacionPush(id, dataPush))
  );

  const fallos = resultados.filter((r) => r.status === "rejected");
  if (fallos.length > 0) {
    console.warn(`[NOTIFICACIONES] ${fallos.length} envíos push fallidos de ${uniqueIds.length}`);
  }
};

const persistirNotificaciones = async (
  usuarioIds:  number[],
  tipo:        TipoNotificacion,
  titulo:      string,
  cuerpo:      string,
  tareaId?:    number
) => {
  const uniqueIds = [...new Set(usuarioIds)].filter((id) => id > 0);
  if (uniqueIds.length === 0) return;

  try {
    await prisma.notificacion.createMany({
      data: uniqueIds.map((usuarioId) => ({
        usuarioId,
        tipo,
        titulo,
        cuerpo,
        tareaId: tareaId ?? null,
      })),
    });
  } catch (error) {
    console.error("[NOTIFY PERSIST] Error al persistir notificaciones:", error);
  }
};

export const notificarNuevoReporte = async (
  reporte: Tarea,
  creador: Usuario | null
) => {
  try {
    const destinatarios = await obtenerIdsPorRol([Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]);
    const nombreCreador = creador?.nombre ?? "Usuario General";
    const titulo = "Nuevo Reporte Recibido 🚨";
    const cuerpo  = `${nombreCreador} reportó: ${reporte.titulo}. Prioridad: ${reporte.prioridad}`;

    await Promise.all([
      distribuirNotificacion(destinatarios, { titulo, cuerpo, url: `/app/tickets/${reporte.id}` }),
      persistirNotificaciones(destinatarios, TipoNotificacion.NUEVO_REPORTE, titulo, cuerpo, reporte.id),
    ]);
  } catch (error) {
    await registrarError("NOTIF_NEW_REPORT_FAIL", 0, error);
  }
};

export const notificarAsignacionTarea = async (
  reporte: TareaConRelaciones,
  idsNuevosResponsables: number[]
) => {
  try {
    const titTecnico  = "Nueva Tarea Asignada 🛠️";
    const cuerTecnico = `Se te asignó: ${reporte.titulo}. Ubicación: ${reporte.planta} - ${reporte.area}`;

    await Promise.all([
      distribuirNotificacion(idsNuevosResponsables, { titulo: titTecnico, cuerpo: cuerTecnico, url: `/app/tickets/${reporte.id}` }),
      persistirNotificaciones(idsNuevosResponsables, TipoNotificacion.TAREA_ASIGNADA, titTecnico, cuerTecnico, reporte.id),
    ]);

    if (reporte.creadorId) {
      const creador = await prisma.usuario.findUnique({
          where: { id: reporte.creadorId },
          select: { rol: true }
      });

      if (creador && creador.rol === Rol.CLIENTE_INTERNO) {
        const titCliente  = "Técnico Asignado 👷";
        const cuerCliente = `Tu reporte "${reporte.titulo}" ya tiene personal asignado y está programado.`;

        await Promise.all([
          distribuirNotificacion([reporte.creadorId], { titulo: titCliente, cuerpo: cuerCliente, url: `/app/tickets/${reporte.id}` }),
          persistirNotificaciones([reporte.creadorId], TipoNotificacion.TAREA_ASIGNADA, titCliente, cuerCliente, reporte.id),
        ]);
      }
    }
  } catch (error) {
    await registrarError("NOTIF_ASSIGN_FAIL", 0, error);
  }
};

export const notificarModificacionTarea = async (
  tarea: TareaConRelaciones,
  actorId: number
) => {
  try {
    const idsTecnicos = (tarea.responsables?.map((u) => u.id) ?? []).filter((id) => id !== actorId);
    if (idsTecnicos.length === 0) return;

    const titulo = "Tarea actualizada";
    const cuerpo  = `La tarea "${tarea.titulo}" ha sido modificada.`;

    await Promise.all([
      distribuirNotificacion(idsTecnicos, { titulo, cuerpo, url: `/app/tickets/${tarea.id}` }),
      persistirNotificaciones(idsTecnicos, TipoNotificacion.TAREA_MODIFICADA, titulo, cuerpo, tarea.id),
    ]);
  } catch (error) {
    await registrarError("NOTIF_MODIFICATION_FAIL", 0, error);
  }
};

export const notificarCambioEstatus = async (
  tarea: TareaConRelaciones,
  nuevoEstado: EstadoTarea,
  actorId: number,
  actorRol?: Rol 
) => {
  try {
    let rolActual = actorRol;
    if (!rolActual) {
      const actorUser = await prisma.usuario.findUnique({
        where: { id: actorId },
        select: { rol: true },
      }).catch(() => null);
      rolActual = actorUser?.rol;
    }

    const idsJefes    = await obtenerIdsPorRol([Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]);
    const idsTecnicos = tarea.responsables?.map((u) => u.id) ?? [];
    const idCliente   = tarea.creadorId;

    // Obtenemos el rol del creador del ticket para aplicar la regla estricta
    let rolCreador: Rol | null = null;
    if (idCliente) {
      const creador = await prisma.usuario.findUnique({
        where: { id: idCliente },
        select: { rol: true }
      });
      rolCreador = creador?.rol ?? null;
    }

    // ── GRUPO A: Cliente (SOLO si es estrictamente CLIENTE_INTERNO) ───────────
    // Esto evita spam de "Tarea Iniciada" a Jefes/Supervisores y elimina 
    // las notificaciones duplicadas cuando ellos mismos crean el ticket.
    if (idCliente && idCliente !== actorId && rolCreador === Rol.CLIENTE_INTERNO) {
      type ClienteEntry = { tipo: TipoNotificacion; msg: string } | null;

      const clienteMap: ClienteEntry = (() => {
        switch (nuevoEstado) {
          case EstadoTarea.EN_PROGRESO:
            return { tipo: TipoNotificacion.TAREA_INICIADA,     msg: "El técnico ha comenzado a trabajar en tu reporte." };
          case EstadoTarea.EN_PAUSA:
            return { tipo: TipoNotificacion.TAREA_PAUSADA,      msg: "El trabajo en tu reporte ha sido pausado temporalmente." };
          case EstadoTarea.RESUELTO:
            return { tipo: TipoNotificacion.REVISION_PENDIENTE, msg: "Trabajo terminado ✅. Por favor valida la solución." };
          case EstadoTarea.RECHAZADO:
            return { tipo: TipoNotificacion.TAREA_RECHAZADA,    msg: "Tu reporte ha sido RECHAZADO. Revisa los comentarios." };
          case EstadoTarea.CANCELADA:
            return { tipo: TipoNotificacion.TAREA_CANCELADA,    msg: "Tu reporte ha sido CANCELADO por administración." };
          case EstadoTarea.CERRADO:
            return { tipo: TipoNotificacion.TAREA_CERRADA,      msg: "Tu reporte ha sido CERRADO definitivamente." };
          default: return null;
        }
      })();

      if (clienteMap) {
        const titulo = `Actualización: ${tarea.titulo}`;
        await Promise.all([
          distribuirNotificacion([idCliente], { titulo, cuerpo: clienteMap.msg, url: `/app/tickets/${tarea.id}` }),
          persistirNotificaciones([idCliente], clienteMap.tipo, titulo, clienteMap.msg, tarea.id),
        ]);
      }
    }

    // ── GRUPO B: Técnicos responsables ───────────────────────────────────────
    const tecnicosAvisar = idsTecnicos.filter((id) => id !== actorId && id !== idCliente);

    if (tecnicosAvisar.length > 0) {
      type TecnicoEntry = { tipo: TipoNotificacion; msg: string } | null;

      const tecnicoMap: TecnicoEntry = (() => {
        switch (nuevoEstado) {
          case EstadoTarea.CANCELADA:
            return { tipo: TipoNotificacion.TAREA_CANCELADA, msg: "⛔ Tarea CANCELADA. Ya no es necesario hacer esta tarea." };
          case EstadoTarea.RECHAZADO:
            return { tipo: TipoNotificacion.TAREA_RECHAZADA, msg: "⚠️ Tu trabajo fue RECHAZADO. Debes revisar y corregir." };
          case EstadoTarea.CERRADO:
            return { tipo: TipoNotificacion.TAREA_CERRADA,   msg: "Tarea completada y cerrada exitosamente." };
          default: return null;
        }
      })();

      if (tecnicoMap) {
        const titulo = "Aviso Importante de Tarea";
        await Promise.all([
          distribuirNotificacion(tecnicosAvisar, { titulo, cuerpo: tecnicoMap.msg, url: `/app/tickets/${tarea.id}` }),
          persistirNotificaciones(tecnicosAvisar, tecnicoMap.tipo, titulo, tecnicoMap.msg, tarea.id),
        ]);
      }
    }

    // ── GRUPO C: Jefes / Coordinadores ────────────────────────────────────────
    // Como los Jefes ya NO entran al Grupo A, ahora sí recibirán limpiamente esta 
    // notificación (sin duplicados) cuando una tarea se Pause o Resuelva.
    const jefesAvisar = idsJefes.filter((id) => id !== actorId);

    if (jefesAvisar.length > 0) {
      switch (nuevoEstado) {
        case EstadoTarea.EN_PAUSA: {
          const titulo = "Supervisión de Mantenimiento";
          const cuerpo  = `🔴 ALERTA: Una tarea en ${tarea.planta} fue PAUSADA por el técnico.`;
          await Promise.all([
            distribuirNotificacion(jefesAvisar, { titulo, cuerpo, url: `/app/tickets/${tarea.id}` }),
            persistirNotificaciones(jefesAvisar, TipoNotificacion.TAREA_PAUSADA, titulo, cuerpo, tarea.id),
          ]);
          break;
        }

        case EstadoTarea.RESUELTO: {
          let destinosRevision: number[];

          if (rolActual === Rol.COORDINADOR_MTTO) {
            const soloJefes = await obtenerIdsPorRol([Rol.JEFE_MTTO]);
            destinosRevision = soloJefes.filter((id) => id !== actorId);
          } else {
            destinosRevision = jefesAvisar;
          }

          if (destinosRevision.length > 0) {
            const titulo = "Tarea pendiente de revisión 🔍";
            const cuerpo  = `La tarea "${tarea.titulo}" fue resuelta y espera tu validación.`;
            await Promise.all([
              distribuirNotificacion(destinosRevision, { titulo, cuerpo, url: `/app/tickets/${tarea.id}` }),
              persistirNotificaciones(destinosRevision, TipoNotificacion.REVISION_PENDIENTE, titulo, cuerpo, tarea.id),
            ]);
          }
          break;
        }

        case EstadoTarea.RECHAZADO: {
          const titulo = "Supervisión de Mantenimiento";
          const cuerpo  = `🔴 ALERTA: El cliente rechazó la tarea resuelta "${tarea.titulo}".`;
          await Promise.all([
            distribuirNotificacion(jefesAvisar, { titulo, cuerpo, url: `/app/tickets/${tarea.id}` }),
            persistirNotificaciones(jefesAvisar, TipoNotificacion.EQUIPO_RECHAZO, titulo, cuerpo, tarea.id),
          ]);
          break;
        }

        case EstadoTarea.CANCELADA: {
          if (actorId === idCliente && rolCreador === Rol.CLIENTE_INTERNO) {
            const titulo = "Supervisión de Mantenimiento";
            const cuerpo  = `🔴 ALERTA: El cliente CANCELÓ el reporte "${tarea.titulo}".`;
            await Promise.all([
              distribuirNotificacion(jefesAvisar, { titulo, cuerpo, url: `/app/tickets/${tarea.id}` }),
              persistirNotificaciones(jefesAvisar, TipoNotificacion.TAREA_CANCELADA, titulo, cuerpo, tarea.id),
            ]);
          }
          break;
        }
      }
    }

  } catch (error) {
    await registrarError("NOTIF_STATUS_CHANGE_FAIL", 0, error);
  }
};