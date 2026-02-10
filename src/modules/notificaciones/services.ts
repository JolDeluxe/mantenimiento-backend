import { enviarNotificacionPush } from "./helper";
import { obtenerIdsPorRol } from "../usuarios/helper";
import { Rol, EstadoTarea } from "@prisma/client"; 
import type { Tarea, Usuario } from "@prisma/client"; 
import { registrarError } from "../../utils/logger";

// --- TIPOS ---
interface PayloadBase {
  titulo: string;
  cuerpo: string;
  url: string;
}

// Tipo extendido para asegurar que la tarea traiga sus relaciones necesarias
type TareaConRelaciones = Tarea & {
  creador?: Usuario | null;
  responsables?: Usuario[];
};

/**
 * Orquestador interno para envío masivo seguro
 */
const distribuirNotificacion = async (idsDestinatarios: number[], payload: PayloadBase) => {
  // Eliminamos duplicados y valores nulos/undefined
  const uniqueIds = [...new Set(idsDestinatarios)].filter(id => id > 0);
  
  if (uniqueIds.length === 0) return;

  const dataPush = {
    title: payload.titulo,
    body: payload.cuerpo,
    url: payload.url,
    icon: "/img/icon-192.png"
  };

  const resultados = await Promise.allSettled(
    uniqueIds.map(id => enviarNotificacionPush(id, dataPush))
  );

  const fallos = resultados.filter(r => r.status === 'rejected');
  if (fallos.length > 0) {
    console.warn(`[NOTIFICACIONES] ${fallos.length} envíos fallidos de ${uniqueIds.length}`);
  }
};

// ==========================================
// 1. NOTIFICACIÓN DE NUEVO REPORTE (CREACIÓN)
// ==========================================

export const notificarNuevoReporte = async (reporte: Tarea, creador: Usuario | null) => {
  try {
    // Destinatarios: Jefes y Coordinadores (Siempre se enteran de todo lo nuevo)
    const destinatarios = await obtenerIdsPorRol([
      Rol.JEFE_MTTO,
      Rol.COORDINADOR_MTTO
    ]);

    const nombreCreador = creador?.nombre || "Usuario General";
    
    await distribuirNotificacion(destinatarios, {
      titulo: "Nuevo Reporte Recibido 🚨",
      cuerpo: `${nombreCreador} reportó: ${reporte.titulo}. Prioridad: ${reporte.prioridad}`,
      url: `/app/tickets/${reporte.id}`
    });

  } catch (error) {
    await registrarError("NOTIF_NEW_REPORT_FAIL", 0, error);
  }
};

// ==========================================
// 2. NOTIFICACIÓN DE ASIGNACIÓN (Update Responsables)
// ==========================================

export const notificarAsignacionTarea = async (reporte: TareaConRelaciones, idsNuevosResponsables: number[]) => {
  try {
    // A. Notificar a los TÉCNICOS asignados
    await distribuirNotificacion(idsNuevosResponsables, {
      titulo: "Nueva Tarea Asignada 🛠️",
      cuerpo: `Se te asignó: ${reporte.titulo}. Ubicación: ${reporte.planta} - ${reporte.area}`,
      url: `/app/tickets/${reporte.id}`
    });

    // B. Notificar al CLIENTE (Creador) si existe
    if (reporte.creadorId) {
      await distribuirNotificacion([reporte.creadorId], {
        titulo: "Técnico Asignado 👷",
        cuerpo: `Tu reporte "${reporte.titulo}" ya tiene personal asignado y está programado.`,
        url: `/app/tickets/${reporte.id}`
      });
    }

  } catch (error) {
    await registrarError("NOTIF_ASSIGN_FAIL", 0, error);
  }
};

// ==========================================
// 3. MATRIZ DE CAMBIO DE ESTADO (Workflow Completo)
// ==========================================

export const notificarCambioEstatus = async (
  tarea: TareaConRelaciones, 
  nuevoEstado: EstadoTarea, 
  actorId: number // ID de quien hizo el cambio (para no auto-notificar)
) => {
  try {
    const idsJefes = await obtenerIdsPorRol([Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]);
    const idsTecnicos = tarea.responsables?.map(u => u.id) || [];
    const idCliente = tarea.creadorId;

    // --- GRUPO A: Notificar al CLIENTE (Creador) ---
    // Solo si el cliente NO fue quien hizo el cambio
    if (idCliente && idCliente !== actorId) {
      let mensajeCliente = "";
      
      switch (nuevoEstado) {
        case EstadoTarea.EN_PROGRESO:
          mensajeCliente = "El técnico ha comenzado a trabajar en tu reporte.";
          break;
        case EstadoTarea.EN_PAUSA:
          mensajeCliente = "El trabajo en tu reporte ha sido pausado temporalmente.";
          break;
        case EstadoTarea.RESUELTO:
          mensajeCliente = "Trabajo terminado ✅. Por favor valida la solución.";
          break;
        case EstadoTarea.RECHAZADO:
          mensajeCliente = "Tu reporte ha sido RECHAZADO. Revisa los comentarios.";
          break;
        case EstadoTarea.CANCELADA:
          mensajeCliente = "Tu reporte ha sido CANCELADO por administración.";
          break;
        case EstadoTarea.CERRADO:
          mensajeCliente = "Tu reporte ha sido CERRADO definitivamente.";
          break;
      }

      if (mensajeCliente) {
        await distribuirNotificacion([idCliente], {
          titulo: `Actualización: ${tarea.titulo}`,
          cuerpo: mensajeCliente,
          url: `/app/tickets/${tarea.id}`
        });
      }
    }

    // --- GRUPO B: Notificar a TÉCNICOS (Responsables) ---
    // Solo si el técnico NO fue quien hizo el cambio (ej. Si Admin cancela o Cliente rechaza)
    const tecnicosAvisar = idsTecnicos.filter(id => id !== actorId);
    
    if (tecnicosAvisar.length > 0) {
      let mensajeTecnico = "";

      switch (nuevoEstado) {
        case EstadoTarea.CANCELADA:
          mensajeTecnico = "⛔ Tarea CANCELADA. Detén labores inmediatamente.";
          break;
        case EstadoTarea.RECHAZADO:
          // Caso: Técnico marcó resuelto, pero Cliente o Jefe lo rechazó
          mensajeTecnico = "⚠️ Tu trabajo fue RECHAZADO. Debes revisar y corregir.";
          break;
        case EstadoTarea.CERRADO:
          mensajeTecnico = "Tarea completada y cerrada exitosamente.";
          break;
      }

      if (mensajeTecnico) {
        await distribuirNotificacion(tecnicosAvisar, {
          titulo: "Aviso Importante de Tarea",
          cuerpo: mensajeTecnico,
          url: `/app/tickets/${tarea.id}`
        });
      }
    }

    // --- GRUPO C: Notificar a JEFES / COORDINADORES ---
    // Solo si el jefe NO fue quien hizo el cambio
    const jefesAvisar = idsJefes.filter(id => id !== actorId);

    if (jefesAvisar.length > 0) {
      let mensajeJefe = "";

      switch (nuevoEstado) {
        case EstadoTarea.EN_PAUSA:
          mensajeJefe = `Alerta: Una tarea en ${tarea.planta} fue PAUSADA por el técnico.`;
          break;
        case EstadoTarea.RESUELTO:
          // Opcional: Para seguimiento cercano
          mensajeJefe = `Control: Tarea marcada como RESUELTA por técnico.`;
          break;
        case EstadoTarea.RECHAZADO:
          // Caso Crítico: El cliente rechazó el trabajo del técnico
          mensajeJefe = `🔴 ALERTA: El cliente rechazó una tarea resuelta.`;
          break;
        case EstadoTarea.CANCELADA:
          // Si el cliente cancela, el jefe debe saberlo para reasignar recursos
          if (actorId === idCliente) {
            mensajeJefe = "El cliente CANCELÓ su reporte.";
          }
          break;
      }

      if (mensajeJefe) {
        await distribuirNotificacion(jefesAvisar, {
          titulo: "Supervisión de Mantenimiento",
          cuerpo: mensajeJefe,
          url: `/app/tickets/${tarea.id}`
        });
      }
    }

  } catch (error) {
    await registrarError("NOTIF_STATUS_CHANGE_FAIL", 0, error);
  }
};