// status/_core.ts
// Motor compartido de cambio de estado.
// Recibe el ticket ya validado + opciones de comportamiento por rol.
// Ejecuta: auto-cierre INSPECCION, intervalos, transacción principal, interlock, notificaciones.
import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento, Rol, Prisma } from "@prisma/client";
import type { FallaMaquina } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { notificarCambioEstatus } from "../../notificaciones/services";
import { deleteImageByUrl } from "../../../utils/cloudinary";
import { getIO } from "../../../utils/socket";
import {
  resolverFallaEnTransaccion,
  confirmarFallaEnTransaccion,
  crearFallaProvisional,
} from "../../bi_maquinaria/services/confirmacion_falla_service";
import { recalcularEstadoMaquina } from "../../maquinas/helper";

export type TicketConResponsables = Prisma.TareaGetPayload<{
  include: { responsables: true };
}>;

export interface CambioEstadoOptions {
  ticketId:              number;
  ticket:                TicketConResponsables;
  nuevoEstado:           EstadoTarea;
  nota:                  string | undefined;
  imagenesFinales:       string[];
  fechaVencimiento:      Date | undefined;
  refacciones:           unknown;
  registroTiempoManual:  { inicioManual?: Date; finManual?: Date; duracionManualMinutos?: number } | undefined;
  maquinaOperativaAlResolver?: boolean;
  cierreAdministrativo?: boolean;
  user:                  { id: number; rol: Rol; email: string; nombre: string };
  req:                   Request;
  res:                   Response;
  // Flags de comportamiento por rol
  autoCloseInspeccion:   boolean; // técnico y admin auto-cierran INSPECCION
  manejarIntervalos:     boolean; // técnico y admin abren/cierran IntervaloTiempo
  // BI Maquinaria FASE 1: datos de resolución de falla (opcional)
  fallaResolucion?: {
    descartar?: boolean;
    impactoConfirmado?: import("@prisma/client").ImpactoProduccionConfirmado;
    fechaFallaConfirmada?: Date;
    inicioParo?: Date;
    porcentajeAfectacion?: number | null;
  };
}

export const ejecutarCambioEstado = async (opts: CambioEstadoOptions): Promise<Response> => {
  const {
    ticketId, ticket, imagenesFinales, fechaVencimiento, refacciones,
    registroTiempoManual, maquinaOperativaAlResolver, cierreAdministrativo = false, user, req, res,
    autoCloseInspeccion, manejarIntervalos, fallaResolucion,
  } = opts;

  let nuevoEstado = opts.nuevoEstado;
  let nota        = opts.nota;

  try {
    if (cierreAdministrativo) {
      nuevoEstado = EstadoTarea.CERRADO;
    }

    // ─── Auto-cierre INSPECCION ───────────────────────────────────────────────
    if (autoCloseInspeccion && nuevoEstado === EstadoTarea.RESUELTO && (ticket.clasificacion as unknown as string) === "INSPECCION") {
      nuevoEstado = EstadoTarea.CERRADO;
      nota = nota ? `${nota} (Cierre automático por Inspección)` : "(Cierre automático por Inspección)";
    }

    // ─── Auto-cierre Creada por y para Administradores ────────────────────────
    const esAdmin = user.rol === "SUPER_ADMIN" || user.rol === "JEFE_MTTO" || user.rol === "COORDINADOR_MTTO";
    const esCreadorYResponsable = ticket.creadorId === user.id && ticket.responsables.some(r => r.id === user.id);
    
    if (nuevoEstado === EstadoTarea.RESUELTO && esAdmin && esCreadorYResponsable) {
      nuevoEstado = EstadoTarea.CERRADO;
      nota = nota ? `${nota} (Cierre automático: Autoasignada)` : "(Cierre automático: Autoasignada)";
    }

    const ahora = new Date();
    const esEstadoResolucion = nuevoEstado === EstadoTarea.RESUELTO || nuevoEstado === EstadoTarea.CERRADO;
    const esCorrectivoDeMaquina = ticket.clasificacion === "CORRECTIVO" && ticket.maquinaId !== null;

    // ─── Registro de tiempo manual ─────────────────────────────────────────────
    let fechaCierreReal        = ahora;
    let esCierreManualAtrasado = false;
    let minutosManualesDirectos = 0;
    let inicioTiempoManual: Date | null = null;
    let finTiempoManual: Date | null = null;
    let intervaloManualSincronizado = false;

    if (esEstadoResolucion && !cierreAdministrativo && registroTiempoManual) {
      const inicioManual = registroTiempoManual.inicioManual ? new Date(registroTiempoManual.inicioManual) : null;
      let finManual = registroTiempoManual.finManual ? new Date(registroTiempoManual.finManual) : null;
      const duracionManual = Number(registroTiempoManual.duracionManualMinutos || 0);

      if (inicioManual && finManual && finManual > inicioManual) {
        inicioTiempoManual = inicioManual;
        finTiempoManual = finManual;
        minutosManualesDirectos = Math.max(1, Math.round((finManual.getTime() - inicioManual.getTime()) / 60000));
        fechaCierreReal = finManual;
        esCierreManualAtrasado = true;
      } else if (finManual) {
        if (finManual > ahora) finManual = ahora;
        fechaCierreReal = finManual;
        finTiempoManual = finManual;
        esCierreManualAtrasado = true;

        if (duracionManual > 0) {
          minutosManualesDirectos = duracionManual;
          inicioTiempoManual = new Date(finManual.getTime() - duracionManual * 60000);
        }
      } else if (duracionManual > 0) {
        minutosManualesDirectos = duracionManual;
        finTiempoManual = ahora;
        inicioTiempoManual = new Date(ahora.getTime() - duracionManual * 60000);
      }
    }

    // ─── BI MAQUINARIA FASE 1: VALIDACIÓN OBLIGATORIA AL RESOLVER CORRECTIVOS DE MÁQUINA ───
    if (esEstadoResolucion && esCorrectivoDeMaquina && !cierreAdministrativo) {
      // 1. Buscar la FallaMaquina vinculada
      let fallaVinculada = await prisma.fallaMaquina.findUnique({
        where: { tareaId: ticketId },
        select: { id: true, estado: true }
      });

      const estadoFallaActual = fallaVinculada ? fallaVinculada.estado : "PENDIENTE_DE_DIAGNOSTICO";
      const requiereDecision = estadoFallaActual === "PENDIENTE_DE_DIAGNOSTICO" || estadoFallaActual === "ABIERTA";

      if (requiereDecision) {
        if (!fallaResolucion) {
          return res.status(400).json({
            error: "Debes completar los datos de cierre de la falla antes de marcar la tarea como resuelta."
          });
        }

        if (fallaResolucion.descartar === true) {
          return res.status(400).json({
            error: "El cierre técnico de correctivos de maquinaria no permite descartar el reporte."
          });
        }

        if (!fallaResolucion.fechaFallaConfirmada) {
          return res.status(400).json({
            error: "La hora real de inicio de la falla es obligatoria."
          });
        }

        const fechaConf = new Date(fallaResolucion.fechaFallaConfirmada);
        if (fechaConf > ahora) {
          return res.status(400).json({
            error: "La hora real de inicio de la falla no puede ser futura."
          });
        }

        const fechaLimiteParo = esCierreManualAtrasado ? fechaCierreReal : ahora;
        if (fechaConf > fechaLimiteParo) {
          return res.status(400).json({
            error: "La hora real de inicio de la falla no puede ser posterior a la restauración de la máquina."
          });
        }

        if (!maquinaOperativaAlResolver) {
          return res.status(400).json({
            error: "Para finalizar, debes confirmar que se realizaron pruebas y la máquina quedó operativa."
          });
        }

        if (!fallaResolucion.impactoConfirmado || fallaResolucion.impactoConfirmado === "NO_CONFIRMADO") {
          return res.status(400).json({
            error: "Debes indicar si hubo paro de producción real y su impacto cuando corresponda."
          });
        }

        const imp = fallaResolucion.impactoConfirmado;
        if (imp === "PARO_PARCIAL" || imp === "PARO_TOTAL") {
          if (!fallaResolucion.inicioParo) {
            return res.status(400).json({
              error: `El inicio del paro es obligatorio para el impacto ${imp}.`
            });
          }
          if (new Date(fallaResolucion.inicioParo) >= fechaLimiteParo) {
            return res.status(400).json({
              error: "El inicio del paro debe ser anterior a la restauración de la máquina."
            });
          }
        }

        if (imp === "PARO_PARCIAL") {
          const pct = fallaResolucion.porcentajeAfectacion;
          if (pct !== undefined && pct !== null) {
            if (pct < 1 || pct > 99) {
              return res.status(400).json({
                error: "El porcentaje de afectación para PARO_PARCIAL debe estar entre 1 y 99%."
              });
            }
          }
        }

        if (imp === "SIN_PARO") {
          if (fallaResolucion.inicioParo) {
            return res.status(400).json({
              error: "No debes proporcionar inicio de paro si seleccionaste SIN_PARO."
            });
          }
          if (fallaResolucion.porcentajeAfectacion !== undefined && fallaResolucion.porcentajeAfectacion !== null) {
            return res.status(400).json({
              error: "No debes proporcionar porcentaje de afectación si seleccionaste SIN_PARO."
            });
          }
        }
      }
    }

    const hayTiempoManual = minutosManualesDirectos > 0 && !!inicioTiempoManual && !!finTiempoManual;

    // ─── Construcción de datosActualizacion ───────────────────────────────────
    const datosActualizacion: Record<string, unknown> = { estado: nuevoEstado, updatedAt: ahora };
    if (refacciones !== undefined) datosActualizacion.refacciones = refacciones;
    if (cierreAdministrativo) datosActualizacion.finalizadoAt = ahora;

    // ─── Intervalo ENTRADA a EN_PROGRESO ──────────────────────────────────────
    if (!cierreAdministrativo && manejarIntervalos && nuevoEstado === EstadoTarea.EN_PROGRESO && ticket.estado !== EstadoTarea.EN_PROGRESO) {
      if (!ticket.fechaInicio) datosActualizacion.fechaInicio = ahora;
      await prisma.intervaloTiempo.create({
        data: { tareaId: ticketId, usuarioId: user.id, inicio: ahora, estado: EstadoTarea.EN_PROGRESO }
      });
    }

    // ─── Intervalo SALIDA de EN_PROGRESO ──────────────────────────────────────
    if (!cierreAdministrativo && manejarIntervalos && ticket.estado === EstadoTarea.EN_PROGRESO && nuevoEstado !== EstadoTarea.EN_PROGRESO) {
      const intervaloAbierto = await prisma.intervaloTiempo.findFirst({
        where: { tareaId: ticketId, fin: null },
        orderBy: { inicio: "desc" }
      });
      if (intervaloAbierto) {
        if (hayTiempoManual) {
          await prisma.intervaloTiempo.update({
            where: { id: intervaloAbierto.id },
            data: {
              inicio: inicioTiempoManual!,
              fin: finTiempoManual!,
              duracion: minutosManualesDirectos
            }
          });
          intervaloManualSincronizado = true;
        } else {
          const finValidado = esCierreManualAtrasado && fechaCierreReal > intervaloAbierto.inicio
          ? fechaCierreReal
          : esCierreManualAtrasado ? intervaloAbierto.inicio : ahora;

          const duracionMin = Math.floor((finValidado.getTime() - intervaloAbierto.inicio.getTime()) / 60000);

          await prisma.intervaloTiempo.update({
            where: { id: intervaloAbierto.id },
            data: { fin: finValidado, duracion: duracionMin }
          });
          await prisma.tarea.update({
            where: { id: ticketId },
            data: { duracionReal: { increment: duracionMin } }
          });
        }
      }
    }

    // ─── Tiempo manual directo ─────────────────────────────────────────────────
    if (!cierreAdministrativo && hayTiempoManual && !intervaloManualSincronizado) {
      await prisma.intervaloTiempo.create({
        data: {
          tareaId:   ticketId,
          usuarioId: user.id,
          estado:    EstadoTarea.EN_PROGRESO,
          inicio:    inicioTiempoManual!,
          fin:       finTiempoManual!,
          duracion:  minutosManualesDirectos
        }
      });
    }

    if (!cierreAdministrativo && hayTiempoManual) {
      datosActualizacion.fechaInicio = inicioTiempoManual;
      datosActualizacion.finalizadoAt = finTiempoManual;
      datosActualizacion.duracionReal = minutosManualesDirectos;
    } else if (!cierreAdministrativo && esEstadoResolucion && !ticket.fechaInicio) {
      datosActualizacion.fechaInicio = ahora;
    }

    if (!cierreAdministrativo && (nuevoEstado === EstadoTarea.RESUELTO || nuevoEstado === EstadoTarea.CERRADO)) {
      if (!hayTiempoManual && !ticket.finalizadoAt) datosActualizacion.finalizadoAt = esCierreManualAtrasado ? fechaCierreReal : ahora;
    }

    if (nuevoEstado === EstadoTarea.RECHAZADO) {
      datosActualizacion.finalizadoAt = null;
      if (fechaVencimiento) datosActualizacion.fechaVencimiento = fechaVencimiento;
    }

    // ─── Transacción principal ─────────────────────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      const tareaActualizada = await tx.tarea.update({
        where: { id: ticketId },
        data: datosActualizacion
      });

      // ─── CANCELACIÓN Y DESCARTE DE FALLA ───
      if (nuevoEstado === EstadoTarea.CANCELADA) {
        const finVal = esCierreManualAtrasado ? fechaCierreReal : ahora;
        const intervaloAbierto = await tx.intervaloTiempo.findFirst({
          where: { tareaId: ticketId, fin: null }
        });
        if (intervaloAbierto) {
          const duracionMin = Math.max(0, Math.floor((finVal.getTime() - intervaloAbierto.inicio.getTime()) / 60000));
          await tx.intervaloTiempo.update({
            where: { id: intervaloAbierto.id },
            data: { fin: finVal, duracion: duracionMin }
          });
          await tx.tarea.update({
            where: { id: ticketId },
            data: { duracionReal: { increment: duracionMin } }
          });
        }

        const paroAbierto = await tx.intervaloParoMaquina.findFirst({
          where: { tareaId: ticketId, fin: null }
        });
        if (paroAbierto) {
          await tx.intervaloParoMaquina.update({
            where: { id: paroAbierto.id },
            data: { fin: ahora }
          });
        }

        const fallaVinculada = await tx.fallaMaquina.findUnique({
          where: { tareaId: ticketId }
        });
        if (fallaVinculada && (fallaVinculada.estado === "PENDIENTE_DE_DIAGNOSTICO" || fallaVinculada.estado === "ABIERTA")) {
          await tx.fallaMaquina.update({
            where: { id: fallaVinculada.id },
            data: {
              estado: "DESCARTADA",
              contabilizaComoFalla: false
            }
          });
        }
      }

      // ─── INTERLOCKS DE MÁQUINA ───
      if (ticket.maquinaId) {
        if (esEstadoResolucion) {
          await tx.maquina.update({
            where: { id: ticket.maquinaId },
            data: { fechaUltimoServicio: ahora }
          });
        }

        // Resolución de falla si aplica
        if (esEstadoResolucion && fallaResolucion) {
          let fallaVinculada = await tx.fallaMaquina.findUnique({
            where: { tareaId: ticketId }
          });

          if (!fallaVinculada) {
            fallaVinculada = await crearFallaProvisional(tx, {
              tareaId: ticketId,
              maquinaId: ticket.maquinaId,
              fechaFallaReportada: ticket.fechaParoProduccion || ticket.createdAt,
            });
          }

          if (fallaVinculada) {
            if (fallaResolucion.descartar === true) {
              throw new Error("El cierre técnico de correctivos de maquinaria no permite descartar el reporte.");
            } else if (fallaResolucion.impactoConfirmado) {
              if (fallaVinculada.estado === "PENDIENTE_DE_DIAGNOSTICO" || fallaVinculada.estado === "ABIERTA") {
                await confirmarFallaEnTransaccion(tx, {
                  fallaId: fallaVinculada.id,
                  tecnicoId: user.id,
                  fechaFallaConfirmada: new Date(fallaResolucion.fechaFallaConfirmada!),
                });
              }

              await resolverFallaEnTransaccion({
                tx,
                fallaId:              fallaVinculada.id,
                maquinaId:            ticket.maquinaId,
                tecnicoId:            user.id,
                fechaRestauracion:    esCierreManualAtrasado ? fechaCierreReal : ahora,
                impactoConfirmado:    fallaResolucion.impactoConfirmado,
                inicioParo:           fallaResolucion.inicioParo,
                porcentajeAfectacion: fallaResolucion.porcentajeAfectacion,
              });
            }
          }
        }

        // Recalcular estado final de la máquina de forma centralizada
        await recalcularEstadoMaquina(ticket.maquinaId, tx, {
          tareaId: ticketId,
          nuevoEstado,
          paroProduccion: ticket.paroProduccion,
          maquinaOperativaAlResolver
        });
      }

      // CANCELADA → limpiar imágenes
      if (nuevoEstado === EstadoTarea.CANCELADA) {
        const imagenesPrevias = await tx.imagen.findMany({
          where: { tareaId: ticketId, NOT: { url: { contains: "no-image.avif" } } }
        });
        if (imagenesPrevias.length > 0) {
          imagenesPrevias.forEach(img => deleteImageByUrl(img.url).catch(console.error));
          const urlPlaceholder = `${req.protocol}://${req.get("host")}/img/no-image.avif`;
          await tx.imagen.updateMany({
            where: { id: { in: imagenesPrevias.map(i => i.id) } },
            data: { url: urlPlaceholder, tipo: "EXPIRADO" }
          });
        }
        imagenesFinales.forEach(url => deleteImageByUrl(url).catch(console.error));
      }

      // Historial
      let notaHistorial = nota ? nota.trim() : "Sin observaciones";
      if (nuevoEstado === EstadoTarea.CERRADO && ((ticket.clasificacion as unknown as string) === "RUTINA" || ticket.categoria === "RUTINA")) {
        notaHistorial += " [RUTINA]";
      }
      if (cierreAdministrativo) notaHistorial += " ||[META:CIERRE_ADMINISTRATIVO]||";
      if (minutosManualesDirectos > 0) notaHistorial += " ||[META:TIEMPO_MANUAL]||";

      const historial = await tx.historialTarea.create({
        data: {
          tareaId:        ticketId,
          usuarioId:      user.id,
          tipo:           TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: ticket.estado,
          estadoNuevo:    nuevoEstado,
          nota:           notaHistorial
        }
      });

      // Imágenes de evidencia
      if (imagenesFinales.length > 0 && nuevoEstado !== EstadoTarea.CANCELADA) {
        let tipoEvidencia = "EVIDENCIA_AVANCE";
        if (nuevoEstado === EstadoTarea.RESUELTO)  tipoEvidencia = "EVIDENCIA_SOLUCION";
        else if (nuevoEstado === EstadoTarea.RECHAZADO) tipoEvidencia = "EVIDENCIA_RECHAZO";
        else if (nuevoEstado === EstadoTarea.CERRADO)   tipoEvidencia = "EVIDENCIA_CIERRE";

        await tx.imagen.createMany({
          data: imagenesFinales.map(url => ({ url, tipo: tipoEvidencia, tareaId: ticketId, historialId: historial.id }))
        });
      }

      return tareaActualizada;
    });

    // ─── Post-transacción ──────────────────────────────────────────────────────
    void notificarCambioEstatus(ticket, nuevoEstado, user.id, user.rol);

    await registrarAccion(
      "CAMBIO_ESTATUS",
      user.id,
      `Ticket ${ticketId}: ${ticket.estado} → ${nuevoEstado} (Usuario: ${user.email})`
        + (minutosManualesDirectos > 0 ? ` | Tiempo manual: ${minutosManualesDirectos} min` : "")
        + (esCierreManualAtrasado ? ` | Fecha real: ${fechaCierreReal.toISOString()}` : "")
    );

    try {
      getIO().to("global_updates").emit("datos_actualizados", { module: "tickets" });
    } catch (_) { /* socket no crítico */ }

    return res.json({ message: "Estatus actualizado correctamente", data: result });

  } catch (error) {
    await registrarError("CHANGE_STATUS", user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};
