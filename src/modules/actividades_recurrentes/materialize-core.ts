import { EstadoTarea, Estatus, Prisma, TipoAjusteRecurrencia, TipoEvento, TipoTarea } from "@prisma/client";
import {
  esCicloOperativoDelPatron,
  fechaEstaEnRango,
  normalizarFechaLogica,
  siguienteCicloOperativo,
} from "../../utils/recurrencia-temporal";
import { ActividadRecurrenteError, programacionTarea, resolverAjuste } from "./helper";
import type { ReglaActividadConRelaciones } from "./types";

export type MaterializacionActividadResultado = {
  tarea: Awaited<ReturnType<typeof crearTarea>> | null;
  yaExistia: boolean;
  omitida: boolean;
  fechaCicloLogica: Date;
  fechaEfectiva: Date | null;
  responsablesIds: number[];
};

async function crearTarea(tx: Prisma.TransactionClient, params: {
  regla: ReglaActividadConRelaciones;
  fechaCicloLogica: Date;
  fechaEfectiva: Date;
  creadorId: number;
  responsablesIds: number[];
}) {
  const { regla, fechaCicloLogica, fechaEfectiva, creadorId, responsablesIds } = params;
  const programacion = programacionTarea(fechaEfectiva, regla);
  const estado = responsablesIds.length > 0 ? EstadoTarea.ASIGNADA : EstadoTarea.PENDIENTE;
  const tarea = await tx.tarea.create({
    data: {
      tipo: TipoTarea.PLANEADA,
      clasificacion: null,
      titulo: regla.titulo,
      descripcion: regla.descripcion ?? "Actividad recurrente programada.",
      categoria: regla.categoria,
      planta: regla.planta,
      area: regla.area,
      prioridad: regla.prioridad,
      estado,
      fechaVencimiento: programacion.fechaVencimiento,
      horaInicioProgramada: programacion.horaInicioProgramada,
      horaFinProgramada: programacion.horaFinProgramada,
      tiempoEstimado: regla.tiempoEstimado,
      maquinaId: null,
      creadorId,
      reglaRecurrenciaId: null,
      reglaActividadRecurrenteId: regla.id,
      fechaCicloLogica,
      fechaProgramadaPreventiva: null,
      responsables: { connect: responsablesIds.map((id) => ({ id })) },
    },
    include: { responsables: true },
  });
  await tx.historialTarea.create({
    data: {
      tareaId: tarea.id,
      usuarioId: creadorId,
      tipo: TipoEvento.CREACION,
      estadoNuevo: estado,
      nota: "Actividad recurrente materializada manualmente.",
    },
  });
  return tarea;
}

export async function materializarActividadEnTransaccion(params: {
  tx: Prisma.TransactionClient;
  regla: ReglaActividadConRelaciones;
  fechaCicloLogica: Date;
  creadorId: number;
}): Promise<MaterializacionActividadResultado> {
  const { tx, regla, creadorId } = params;
  const fechaCicloLogica = normalizarFechaLogica(params.fechaCicloLogica);
  const patron = { fechaInicio: regla.fechaInicio, fechaFin: regla.fechaFin, unidad: regla.unidad, intervalo: regla.intervalo };
  if (!esCicloOperativoDelPatron(patron, fechaCicloLogica)) {
    throw new ActividadRecurrenteError("La fecha solicitada no pertenece al patrón operativo de la regla");
  }
  const ajuste = await tx.reglaActividadRecurrenteAjuste.findUnique({
    where: { reglaActividadRecurrenteId_fechaOriginal: { reglaActividadRecurrenteId: regla.id, fechaOriginal: fechaCicloLogica } },
  });
  const resolved = resolverAjuste(fechaCicloLogica, ajuste?.activo ? ajuste : null);
  if (resolved.omitida) {
    if (normalizarFechaLogica(regla.proximaFechaEjecucion).getTime() === fechaCicloLogica.getTime()) {
      await tx.reglaActividadRecurrente.update({
        where: { id: regla.id },
        data: { proximaFechaEjecucion: siguienteCicloOperativo({ ...patron, fechaFin: null }, fechaCicloLogica) },
      });
    }
    return { tarea: null, yaExistia: false, omitida: true, fechaCicloLogica, fechaEfectiva: null, responsablesIds: [] };
  }
  if (!fechaEstaEnRango(patron, resolved.fechaProgramada)) {
    throw new ActividadRecurrenteError("La fecha efectiva queda fuera del rango de vigencia de la regla");
  }
  const existente = await tx.tarea.findFirst({
    where: { reglaActividadRecurrenteId: regla.id, fechaCicloLogica },
    include: { responsables: true },
  });
  if (existente) {
    return { tarea: existente, yaExistia: true, omitida: false, fechaCicloLogica, fechaEfectiva: resolved.fechaProgramada, responsablesIds: existente.responsables.map((responsable) => responsable.id) };
  }
  const responsablesIds = (await tx.usuario.findMany({
    where: { id: { in: regla.responsables.map((responsable) => responsable.id) }, estado: Estatus.ACTIVO },
    select: { id: true },
  })).map((responsable) => responsable.id);
  const tarea = await crearTarea(tx, { regla, fechaCicloLogica, fechaEfectiva: resolved.fechaProgramada, creadorId, responsablesIds });

  if (normalizarFechaLogica(regla.proximaFechaEjecucion).getTime() === fechaCicloLogica.getTime()) {
    await tx.reglaActividadRecurrente.update({
      where: { id: regla.id },
      data: { proximaFechaEjecucion: siguienteCicloOperativo({ ...patron, fechaFin: null }, fechaCicloLogica) },
    });
  }
  return { tarea, yaExistia: false, omitida: false, fechaCicloLogica, fechaEfectiva: resolved.fechaProgramada, responsablesIds };
}

export const esErrorUnicoDeCiclo = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const esErrorConcurrenciaDeCiclo = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
