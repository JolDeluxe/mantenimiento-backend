import { enviarNotificacionPush }    from "./helper";
import { obtenerIdsPorRol }          from "../usuarios/helper";
import { Rol, EstadoTarea, TipoNotificacion } from "@prisma/client";
import type { Tarea, Usuario }       from "@prisma/client";
import { registrarError }            from "../../utils/logger";
import { prisma }                    from "../../db";
import type { PayloadBase, TareaConRelaciones } from "./types";
import { getIO } from "../../utils/socket"; 

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
    icon:  "/CUADRA_MANTENIMIENTO_LOGO.webp",
  };

  const resultados = await Promise.allSettled(
    uniqueIds.map((id) => enviarNotificacionPush(id, dataPush))
  );

  const fallos = resultados.filter((r) => r.status === "rejected");
  if (fallos.length > 0) {
    console.warn(`[NOTIFICACIONES] ${fallos.length} envíos push fallidos de ${uniqueIds.length}`);
  }
};

export const persistirNotificaciones = async (
  usuarioIds: number[],
  tipo: TipoNotificacion,
  titulo: string,
  cuerpo: string,
  tareaId?: number
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

    try {
      const io = getIO();
      for (const id of uniqueIds) {
        io.to(`user_${id}`).emit("notificacion_recibida", {
          tipo,
          titulo,
          mensaje: cuerpo,
          tareaId: tareaId ?? null,
        });
      }
    } catch (_) {
      // Degradación silenciosa
    }

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
    const titulo = "🔔 Nuevo Reporte";
    const cuerpo  = `${nombreCreador} reportó: ${reporte.titulo}. ⚡ Prioridad: ${reporte.prioridad}`;

    // Matriz: src\features\tickets\pages\tickets-bandeja.jsx
    const urlDestino = `/tickets/bandeja?ticketId=${reporte.id}`;

    await Promise.all([
      distribuirNotificacion(destinatarios, { titulo, cuerpo, url: urlDestino }),
      persistirNotificaciones(destinatarios, TipoNotificacion.NUEVO_REPORTE, titulo, cuerpo, reporte.id),
    ]);
  } catch (error) {
    await registrarError("NOTIF_NEW_REPORT_FAIL", null, error);
  }
};

export const notificarAsignacionTarea = async (
  reporte: TareaConRelaciones,
  idsNuevosResponsables: number[]
) => {
  try {
    const titTecnico  = "👨‍🔧 Nueva Tarea Asignada";
    const cuerTecnico = `Se te asignó: ${reporte.titulo}. 📍 Ubicación: ${reporte.planta} - ${reporte.area}`;
    
    // Matriz: src\features\tickets\pages\tickets-page.jsx (Vista de operaciones de técnicos / Hoy)
    const urlDestino = `/tickets/hoy?ticketId=${reporte.id}`;

    await Promise.all([
      distribuirNotificacion(idsNuevosResponsables, { titulo: titTecnico, cuerpo: cuerTecnico, url: urlDestino }),
      persistirNotificaciones(idsNuevosResponsables, TipoNotificacion.TAREA_ASIGNADA, titTecnico, cuerTecnico, reporte.id),
    ]);

    if (reporte.creadorId) {
      const creador = await prisma.usuario.findUnique({
          where: { id: reporte.creadorId },
          select: { rol: true }
      });

      if (creador && creador.rol === Rol.CLIENTE_INTERNO) {
        const titCliente  = "👷‍♂️ Técnico Asignado";
        const cuerCliente = `Tu reporte "${reporte.titulo}" ya tiene personal asignado y está programado.`;

        await Promise.all([
          distribuirNotificacion([reporte.creadorId], { titulo: titCliente, cuerpo: cuerCliente, url: urlDestino }),
          persistirNotificaciones([reporte.creadorId], TipoNotificacion.TAREA_ASIGNADA, titCliente, cuerCliente, reporte.id),
        ]);
      }
    }
  } catch (error) {
    await registrarError("NOTIF_ASSIGN_FAIL", null, error);
  }
};

export const notificarModificacionTarea = async (
  tarea: TareaConRelaciones,
  actorId: number
) => {
  try {
    const idsTecnicos = (tarea.responsables?.map((u) => u.id) ?? []).filter((id) => id !== actorId);
    if (idsTecnicos.length === 0) return;

    const titulo = "📝 Tarea Actualizada";
    const cuerpo  = `La tarea "${tarea.titulo}" ha sufrido modificaciones en sus detalles.`;
    
    // Matriz: src\features\notificaciones\pages\notify-page.jsx
    const urlDestino = `/notificaciones?ticketId=${tarea.id}`;

    await Promise.all([
      distribuirNotificacion(idsTecnicos, { titulo, cuerpo, url: urlDestino }),
      persistirNotificaciones(idsTecnicos, TipoNotificacion.TAREA_MODIFICADA, titulo, cuerpo, tarea.id),
    ]);
  } catch (error) {
    await registrarError("NOTIF_MODIFICATION_FAIL", null, error);
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

    let rolCreador: Rol | null = null;
    if (idCliente) {
      const creador = await prisma.usuario.findUnique({
        where: { id: idCliente },
        select: { rol: true }
      });
      rolCreador = creador?.rol ?? null;
    }

    // Matriz: src\features\notificaciones\pages\notify-page.jsx (Aplica a todos los estatus)
    const urlDestino = `/notificaciones?ticketId=${tarea.id}`;

    if (idCliente && idCliente !== actorId && rolCreador === Rol.CLIENTE_INTERNO) {
      type ClienteEntry = { tipo: TipoNotificacion; msg: string } | null;

      const clienteMap: ClienteEntry = (() => {
        switch (nuevoEstado) {
          case EstadoTarea.EN_PROGRESO: return { tipo: TipoNotificacion.TAREA_INICIADA,     msg: "▶️ El técnico ha comenzado a trabajar en tu reporte." };
          case EstadoTarea.EN_PAUSA:    return { tipo: TipoNotificacion.TAREA_PAUSADA,      msg: "⏸️ El trabajo en tu reporte ha sido pausado temporalmente." };
          case EstadoTarea.RESUELTO:    return { tipo: TipoNotificacion.REVISION_PENDIENTE, msg: "👀 Trabajo terminado. Por favor valida la solución en la app." };
          case EstadoTarea.RECHAZADO:   return { tipo: TipoNotificacion.TAREA_RECHAZADA,    msg: "❌ Tu reporte ha sido RECHAZADO. Revisa los comentarios." };
          case EstadoTarea.CANCELADA:   return { tipo: TipoNotificacion.TAREA_CANCELADA,    msg: "🚫 Tu reporte ha sido CANCELADO por administración." };
          case EstadoTarea.CERRADO:     return { tipo: TipoNotificacion.TAREA_CERRADA,      msg: "🔒 Tu reporte ha sido CERRADO definitivamente." };
          default: return null;
        }
      })();

      if (clienteMap) {
        const titulo = `Actualización: ${tarea.titulo}`;
        await Promise.all([
          distribuirNotificacion([idCliente], { titulo, cuerpo: clienteMap.msg, url: urlDestino }),
          persistirNotificaciones([idCliente], clienteMap.tipo, titulo, clienteMap.msg, tarea.id),
        ]);
      }
    }

    const tecnicosAvisar = idsTecnicos.filter((id) => id !== actorId && id !== idCliente);

    if (tecnicosAvisar.length > 0) {
      type TecnicoEntry = { tipo: TipoNotificacion; msg: string } | null;

      const tecnicoMap: TecnicoEntry = (() => {
        switch (nuevoEstado) {
          case EstadoTarea.CANCELADA: return { tipo: TipoNotificacion.TAREA_CANCELADA, msg: "🚫 Tarea CANCELADA. Ya no es necesario ejecutar este trabajo." };
          case EstadoTarea.RECHAZADO: return { tipo: TipoNotificacion.TAREA_RECHAZADA, msg: "⚠️ Trabajo RECHAZADO. Debes revisar las notas del cliente y corregir." };
          case EstadoTarea.CERRADO:   return { tipo: TipoNotificacion.TAREA_CERRADA,   msg: "🏆 Tarea completada y cerrada exitosamente. ¡Buen trabajo!" };
          default: return null;
        }
      })();

      if (tecnicoMap) {
        const titulo = "ℹ️ Aviso de Tarea";
        await Promise.all([
          distribuirNotificacion(tecnicosAvisar, { titulo, cuerpo: tecnicoMap.msg, url: urlDestino }),
          persistirNotificaciones(tecnicosAvisar, tecnicoMap.tipo, titulo, tecnicoMap.msg, tarea.id),
        ]);
      }
    }

    const jefesAvisar = idsJefes.filter((id) => id !== actorId);

    if (jefesAvisar.length > 0) {
      switch (nuevoEstado) {
        case EstadoTarea.RESUELTO: {
          let destinosRevision: number[];

          if (rolActual === Rol.COORDINADOR_MTTO) {
            const soloJefes = await obtenerIdsPorRol([Rol.JEFE_MTTO]);
            destinosRevision = soloJefes.filter((id) => id !== actorId);
          } else {
            destinosRevision = jefesAvisar;
          }

          if (destinosRevision.length > 0) {
            const titulo = "🔍 Pendiente de Revisión";
            const cuerpo  = `La tarea "${tarea.titulo}" fue resuelta y espera tu validación.`;
            await Promise.all([
              distribuirNotificacion(destinosRevision, { titulo, cuerpo, url: urlDestino }),
              persistirNotificaciones(destinosRevision, TipoNotificacion.REVISION_PENDIENTE, titulo, cuerpo, tarea.id),
            ]);
          }
          break;
        }

        case EstadoTarea.RECHAZADO: {
          const titulo = "⚠️ Supervisión Requerida";
          const cuerpo  = `El cliente ha rechazado el trabajo de la tarea "${tarea.titulo}".`;
          await Promise.all([
            distribuirNotificacion(jefesAvisar, { titulo, cuerpo, url: urlDestino }),
            persistirNotificaciones(jefesAvisar, TipoNotificacion.EQUIPO_RECHAZO, titulo, cuerpo, tarea.id),
          ]);
          break;
        }

        case EstadoTarea.CANCELADA: {
          if (actorId === idCliente && rolCreador === Rol.CLIENTE_INTERNO) {
            const titulo = "🗑️ Tarea Cancelada";
            const cuerpo  = `El cliente ha CANCELADO su reporte "${tarea.titulo}".`;
            await Promise.all([
              distribuirNotificacion(jefesAvisar, { titulo, cuerpo, url: urlDestino }),
              persistirNotificaciones(jefesAvisar, TipoNotificacion.TAREA_CANCELADA, titulo, cuerpo, tarea.id),
            ]);
          }
          break;
        }
      }
    }

  } catch (error) {
    await registrarError("NOTIF_STATUS_CHANGE_FAIL", null, error);
  }
};

export const notificarAdvertenciaTurno = async (idsTecnicos: number[]) => {
  try {
    const titulo = "⚠️ Turno por terminar";
    const cuerpo = "Tienes tareas EN PROGRESO. Recuerda pausarlas o finalizarlas antes de irte.";
    const urlDestino = `/tickets/hoy`;

    await Promise.all([
      distribuirNotificacion(idsTecnicos, { titulo, cuerpo, url: urlDestino }),
      persistirNotificaciones(idsTecnicos, TipoNotificacion.TAREA_MODIFICADA, titulo, cuerpo)
    ]);
  } catch (error) {
    await registrarError("NOTIF_ADVERTENCIA_TURNO", null, error);
  }
};

export const notificarAutoPausa = async (idsTecnicos: number[]) => {
  try {
    const titulo = "⏸️ Tareas Pausadas Automáticamente";
    const cuerpo = "El sistema ha pausado tus tareas por fin de turno. Si sigues trabajando, inicia la tarea nuevamente.";
    const urlDestino = `/tickets/hoy`;

    await Promise.all([
      distribuirNotificacion(idsTecnicos, { titulo, cuerpo, url: urlDestino }),
      persistirNotificaciones(idsTecnicos, TipoNotificacion.TAREA_PAUSADA, titulo, cuerpo)
    ]);
  } catch (error) {
    await registrarError("NOTIF_AUTOPAUSA_TURNO", null, error);
  }
};
