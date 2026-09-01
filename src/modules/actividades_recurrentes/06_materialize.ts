import type { Request, Response } from "express";
import { prisma } from "../../db";
import { formatearFechaLogica, normalizarFechaLogica } from "../../utils/recurrencia-temporal";
import { ejecutarNotificacionEnSegundoPlano, notificarAsignacionTarea } from "../notificaciones/services";
import { registrarAccion } from "../../utils/logger";
import { ActividadRecurrenteError } from "./helper";
import { esErrorConcurrenciaDeCiclo, materializarActividadEnTransaccion, type MaterializacionActividadResultado } from "./materialize-core";
import { resolverPoliticaMaterializacionActividad } from "./materialization-policy";
import { reglaActividadInclude } from "./types";

const hoyMX = () => normalizarFechaLogica(new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }));

export async function notificarAsignacionTrasCommit(
  tarea: NonNullable<MaterializacionActividadResultado["tarea"]>,
  responsablesIds: number[],
  notificar = notificarAsignacionTarea,
) {
  try {
    await notificar(tarea, responsablesIds);
  } catch (error) {
    console.error("[actividades-recurrentes] notificación posterior a materialización falló:", error);
  }
}

export async function materializarReglaActividad(req: Request, res: Response) {
  const id = Number(req.params.id);
  const userId = req.user!.id;
  let fechaSolicitada: Date | null = null;
  try {
    const body = req.body as { fechaCicloLogica?: string; confirmarFuturo: boolean };
    const regla = await prisma.reglaActividadRecurrente.findUnique({ where: { id }, include: reglaActividadInclude });
    if (!regla) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    if (regla.archivadoAt) return res.status(400).json({ error: "La regla está archivada y no puede materializar tareas" });
    if (!regla.activo) return res.status(400).json({ error: "La regla está pausada y no puede materializar tareas" });
    const hoy = hoyMX();
    const fechaExplicita = Boolean(body.fechaCicloLogica);
    const decision = resolverPoliticaMaterializacionActividad(regla, hoy);
    const fechaCicloLogica = normalizarFechaLogica(body.fechaCicloLogica ?? decision.fechaCicloLogica ?? decision.proximaFechaEjecucion);
    fechaSolicitada = fechaCicloLogica;
    if (fechaCicloLogica < hoy) {
      if (decision.fechaCicloLogica?.getTime() !== fechaCicloLogica.getTime()) {
        return res.status(400).json({ error: "Solo se permite recuperar la última ocurrencia vencida pendiente; no ciclos históricos anteriores" });
      }
    }
    if (fechaCicloLogica > hoy && !body.confirmarFuturo) {
      return res.status(400).json({ error: "Materializar un ciclo futuro requiere confirmación explícita", requiereConfirmacion: true });
    }
    if (!fechaExplicita && !decision.fechaCicloLogica) {
      if (decision.requiereActualizarCursor) {
        await prisma.reglaActividadRecurrente.update({
          where: { id },
          data: { proximaFechaEjecucion: decision.proximaFechaEjecucion },
        });
      }
      return res.status(200).json({
        success: true,
        data: null,
        yaExistia: false,
        fechaCicloLogica: null,
        fechaEfectiva: null,
        mensaje: "No hay ciclo materializable hoy. La próxima fecha quedó alineada al siguiente ciclo válido.",
      });
    }
    const reglaParaMaterializar = decision.fechaCicloLogica?.getTime() === fechaCicloLogica.getTime()
      ? { ...regla, proximaFechaEjecucion: fechaCicloLogica }
      : regla;
    const result = await prisma.$transaction((tx) => materializarActividadEnTransaccion({ tx, regla: reglaParaMaterializar, fechaCicloLogica, creadorId: userId }));
    if (result.omitida) {
      await registrarAccion(
        "OMITIR_MATERIALIZACION_ACTIVIDAD_RECURRENTE",
        userId,
        `Regla ${id} | ciclo ${formatearFechaLogica(result.fechaCicloLogica)} | ocurrencia omitida`,
      );
      return res.status(200).json({
        success: true,
        data: null,
        omitida: true,
        yaExistia: false,
        fechaCicloLogica: formatearFechaLogica(result.fechaCicloLogica),
        fechaEfectiva: null,
      });
    }

    if (!result.yaExistia && result.tarea && result.responsablesIds.length > 0) {
      ejecutarNotificacionEnSegundoPlano(
        "NOTIF_ASYNC_ACTIVIDAD_RECURRENTE_MATERIALIZADA",
        notificarAsignacionTrasCommit(result.tarea, result.responsablesIds)
      );
    }
    await registrarAccion(
      "MATERIALIZAR_ACTIVIDAD_RECURRENTE",
      userId,
      `Regla ${id} | ciclo ${formatearFechaLogica(result.fechaCicloLogica)} | tarea ${result.tarea?.id ?? "sin tarea"} | existente=${result.yaExistia}`,
    );
    return res.status(result.yaExistia ? 200 : 201).json({
      success: true,
      data: result.tarea,
      yaExistia: result.yaExistia,
      fechaCicloLogica: formatearFechaLogica(result.fechaCicloLogica),
      fechaEfectiva: result.fechaEfectiva ? formatearFechaLogica(result.fechaEfectiva) : null,
    });
  } catch (error) {
    if (error instanceof ActividadRecurrenteError) return res.status(error.status).json({ error: error.message });
    if (esErrorConcurrenciaDeCiclo(error) && fechaSolicitada) {
      const fechaCicloLogica = fechaSolicitada;
      for (let intento = 0; intento < 3; intento += 1) {
        const existente = await prisma.tarea.findFirst({ where: { reglaActividadRecurrenteId: id, fechaCicloLogica }, include: { responsables: true } });
        if (existente) return res.status(200).json({ success: true, data: existente, yaExistia: true, fechaCicloLogica: formatearFechaLogica(fechaCicloLogica) });
        await new Promise((resolve) => setTimeout(resolve, 25 * (intento + 1)));
      }
    }
    console.error("[actividades-recurrentes] materializarReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al materializar la actividad recurrente" });
  }
}
