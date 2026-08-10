/**
 * confirmacion_falla_service.ts
 *
 * Servicio transaccional de FASE 1 - Métricas de Maquinaria.
 * Encapsula toda la lógica de negocio relativa a:
 *   - Creación provisional de FallaMaquina al nacer una tarea correctiva.
 *   - Confirmación de la falla por el técnico (PENDIENTE_DE_DIAGNOSTICO → ABIERTA).
 *   - Descarte de la falla (PENDIENTE_DE_DIAGNOSTICO / ABIERTA → DESCARTADA).
 *   - Resolución técnica: graba fechaRestauracion + crea o actualiza IntervaloParoMaquina.
 *   - La aprobación o rechazo del cliente NO modifica ningún campo de FallaMaquina.
 *
 * Reglas de negocio críticas:
 *   - SIN_PARO     → no se crea IntervaloParoMaquina.
 *   - PARO_PARCIAL → se crea intervalo con porcentajeAfectacion null | 1-99.
 *   - PARO_TOTAL   → se crea intervalo con porcentajeAfectacion = 100.
 *   - duracionMinutos NO se persiste; se calcula siempre en runtime desde inicio/fin.
 *   - Toda operación se ejecuta dentro de una transacción Prisma.
 *   - No se utilizan triggers MySQL.
 */

import { prisma } from "../../../db";
import {
  CalidadDato,
  EstadoFalla,
  ImpactoProduccionConfirmado,
  TipoParo,
  type Prisma,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// TIPOS DE ENTRADA
// ---------------------------------------------------------------------------

/** Parámetros para crear la FallaMaquina provisional cuando nace una tarea correctiva. */
export interface CrearFallaProvisionaInput {
  tareaId: number;
  maquinaId: number;
  /** Fecha que reportó el cliente (fechaParoProduccion o createdAt de la tarea). */
  fechaFallaReportada: Date;
}

/** Parámetros para confirmar la falla durante el diagnóstico técnico. */
export interface ConfirmarFallaInput {
  fallaId: number;
  /** Técnico que confirma. */
  tecnicoId: number;
  /**
   * Fecha en que realmente ocurrió la falla.
   * El técnico puede aceptar la fecha del cliente o corregirla.
   * Obligatorio al confirmar.
   */
  fechaFallaConfirmada: Date;
}

/** Parámetros para descartar la falla (el técnico determina que no hubo avería real). */
export interface DescartarFallaInput {
  fallaId: number;
  /** Técnico que descarta. */
  tecnicoId: number;
}

/** Parámetros para resolver la falla al marcar la tarea como RESUELTO. */
export interface ResolverFallaInput {
  fallaId: number;
  maquinaId: number;
  /** Técnico que confirma la restauración. */
  tecnicoId: number;
  /** Momento en que la máquina quedó funcional (coincide con finalizadoAt de la Tarea). */
  fechaRestauracion: Date;
  /** Impacto confirmado en producción. */
  impactoConfirmado: ImpactoProduccionConfirmado;
  /**
   * Inicio real del paro físico.
   * Requerido cuando impactoConfirmado = PARO_PARCIAL | PARO_TOTAL.
   * Debe ser anterior a fechaRestauracion.
   */
  inicioParo?: Date;
  /**
   * Porcentaje de afectación (solo para PARO_PARCIAL).
   * null = no disponible → calidad DATO_INCOMPLETO.
   * 1-99 = valor confirmado.
   * PARO_TOTAL siempre = 100.
   */
  porcentajeAfectacion?: number | null;
  /** Referencia a la transacción Prisma en curso (desde _core.ts). */
  tx: Prisma.TransactionClient;
}

// ---------------------------------------------------------------------------
// FUNCIONES DE SERVICIO
// ---------------------------------------------------------------------------

/**
 * Crea la FallaMaquina provisional cuando nace una Tarea correctiva vinculada a máquina.
 * Estado inicial: PENDIENTE_DE_DIAGNOSTICO, calidad: PROVISIONAL.
 * Se invoca desde create_cliente.ts o create_admin.ts dentro de la transacción de creación.
 */
export async function crearFallaProvisional(
  tx: Prisma.TransactionClient,
  input: CrearFallaProvisionaInput,
) {
  const existente = await tx.fallaMaquina.findUnique({
    where: { tareaId: input.tareaId },
  });
  if (existente) return existente; // Idempotente: no crear duplicado.

  // Snapshot de la máquina en este momento.
  const maquina = await tx.maquina.findUniqueOrThrow({
    where: { id: input.maquinaId },
    select: { codigo: true, planta: true, area: true, proceso: true, criticidad: true },
  });

  return tx.fallaMaquina.create({
    data: {
      maquinaId:            input.maquinaId,
      tareaId:              input.tareaId,
      estado:               EstadoFalla.PENDIENTE_DE_DIAGNOSTICO,
      calidadDato:          CalidadDato.PROVISIONAL,
      contabilizaComoFalla: true,
      impactoConfirmado:    ImpactoProduccionConfirmado.NO_CONFIRMADO,
      fechaFallaReportada:  input.fechaFallaReportada,
      // fechaFallaConfirmada y confirmadoPorId son null hasta el diagnóstico técnico.
      snapshotCodigo:       maquina.codigo,
      snapshotPlanta:       maquina.planta ?? null,
      snapshotArea:         maquina.area ?? null,
      snapshotProceso:      maquina.proceso,
      snapshotCriticidad:   maquina.criticidad ?? null,
    },
  });
}

/**
 * El técnico confirma que existe una falla real durante su diagnóstico.
 * PENDIENTE_DE_DIAGNOSTICO → ABIERTA, calidad: CONFIRMADO.
 * Ejecutado fuera de la transacción de cambio de estado (llamada directa desde el controlador).
 */
export async function confirmarFalla(input: ConfirmarFallaInput) {
  return prisma.$transaction(async (tx) => {
    return confirmarFallaEnTransaccion(tx, input);
  });
}

/** Versión transaccional de confirmarFalla. */
export async function confirmarFallaEnTransaccion(
  tx: Prisma.TransactionClient,
  input: ConfirmarFallaInput,
) {
  const falla = await tx.fallaMaquina.findUniqueOrThrow({
    where: { id: input.fallaId },
    select: { id: true, estado: true },
  });

  if (
    falla.estado !== EstadoFalla.PENDIENTE_DE_DIAGNOSTICO &&
    falla.estado !== EstadoFalla.ABIERTA
  ) {
    throw new Error(
      `No se puede confirmar una falla en estado "${falla.estado}".`,
    );
  }

  if (input.fechaFallaConfirmada > new Date()) {
    throw new Error("La fecha de confirmación de la falla no puede ser futura.");
  }

  return tx.fallaMaquina.update({
    where: { id: input.fallaId },
    data: {
      estado:               EstadoFalla.ABIERTA,
      calidadDato:          CalidadDato.CONFIRMADO,
      fechaFallaConfirmada: input.fechaFallaConfirmada,
      confirmadoPorId:      input.tecnicoId,
    },
  });
}

/**
 * El técnico descarta la falla: determina que no hubo avería real.
 * PENDIENTE_DE_DIAGNOSTICO | ABIERTA → DESCARTADA, contabilizaComoFalla = false.
 * No alimenta métricas de Frecuencia, MTTR ni MTBF.
 */
export async function descartarFalla(input: DescartarFallaInput) {
  return prisma.$transaction(async (tx) => {
    return descartarFallaEnTransaccion(tx, input);
  });
}

/** Versión transaccional de descartarFalla. */
export async function descartarFallaEnTransaccion(
  tx: Prisma.TransactionClient,
  input: DescartarFallaInput,
) {
  const falla = await tx.fallaMaquina.findUniqueOrThrow({
    where: { id: input.fallaId },
    select: { id: true, estado: true },
  });

  const estadosDescartables = new Set<EstadoFalla>([
    EstadoFalla.PENDIENTE_DE_DIAGNOSTICO,
    EstadoFalla.ABIERTA,
  ]);

  if (!estadosDescartables.has(falla.estado)) {
    throw new Error(
      `No se puede descartar una falla en estado "${falla.estado}". Solo PENDIENTE_DE_DIAGNOSTICO y ABIERTA son descartables.`,
    );
  }

  return tx.fallaMaquina.update({
    where: { id: input.fallaId },
    data: {
      estado:               EstadoFalla.DESCARTADA,
      contabilizaComoFalla: false,
      confirmadoPorId:      input.tecnicoId,
    },
  });
}

/**
 * Resolución técnica de la falla.
 * Se invoca DENTRO de la transacción Prisma de cambio de estado (desde _core.ts al detectar RESUELTO).
 *
 * Acciones atómicas:
 *  1. Actualiza FallaMaquina → REHABILITADA + fechaRestauracion + impactoConfirmado.
 *  2. Si PARO_PARCIAL o PARO_TOTAL: crea o actualiza IntervaloParoMaquina con inicio=inicioParo, fin=fechaRestauracion.
 *  3. Si SIN_PARO: no crea ningún IntervaloParoMaquina.
 *
 * Validaciones:
 *  - fechaFallaConfirmada no puede ser posterior a fechaRestauracion.
 *  - inicioParo debe ser anterior a fechaRestauracion.
 *  - PARO_TOTAL exige porcentajeAfectacion = 100.
 *  - PARO_PARCIAL acepta porcentaje null (1-99 si se provee).
 */
export async function resolverFallaEnTransaccion(input: ResolverFallaInput) {
  const { tx, fallaId, maquinaId, tecnicoId, fechaRestauracion, impactoConfirmado } = input;

  // Leer la falla dentro de la transacción.
  const falla = await tx.fallaMaquina.findUniqueOrThrow({
    where: { id: fallaId },
    select: {
      id:                   true,
      estado:               true,
      fechaFallaConfirmada: true,
      tareaId:              true,
    },
  });

  // Solo se puede resolver si la falla está ABIERTA.
  if (falla.estado !== EstadoFalla.ABIERTA) {
    throw new Error(
      `No se puede resolver una falla en estado "${falla.estado}". Solo ABIERTA es resoluble.`,
    );
  }

  // Validación temporal: la fecha de confirmación debe ser anterior a la restauración.
  if (
    falla.fechaFallaConfirmada &&
    falla.fechaFallaConfirmada > fechaRestauracion
  ) {
    throw new Error(
      "La fechaFallaConfirmada no puede ser posterior a la fechaRestauracion.",
    );
  }

  // ---------------------------------------------------------------------------
  // Validaciones específicas por tipo de impacto
  // ---------------------------------------------------------------------------
  if (
    impactoConfirmado === ImpactoProduccionConfirmado.PARO_PARCIAL ||
    impactoConfirmado === ImpactoProduccionConfirmado.PARO_TOTAL
  ) {
    if (!input.inicioParo) {
      throw new Error(
        `El inicio del paro es obligatorio cuando el impacto es ${impactoConfirmado}.`,
      );
    }
    if (input.inicioParo >= fechaRestauracion) {
      throw new Error(
        "El inicio del paro debe ser anterior a la fecha de restauración.",
      );
    }
  }

  if (impactoConfirmado === ImpactoProduccionConfirmado.PARO_TOTAL) {
    if (input.porcentajeAfectacion !== undefined && input.porcentajeAfectacion !== null && input.porcentajeAfectacion !== 100) {
      throw new Error("PARO_TOTAL requiere porcentajeAfectacion = 100.");
    }
  }

  if (impactoConfirmado === ImpactoProduccionConfirmado.PARO_PARCIAL) {
    if (
      input.porcentajeAfectacion !== undefined &&
      input.porcentajeAfectacion !== null &&
      (input.porcentajeAfectacion < 1 || input.porcentajeAfectacion > 99)
    ) {
      throw new Error(
        "Para PARO_PARCIAL, porcentajeAfectacion debe ser un entero entre 1 y 99 (o null si no está disponible).",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Actualizar FallaMaquina → REHABILITADA
  // ---------------------------------------------------------------------------
  const fallaActualizada = await tx.fallaMaquina.update({
    where: { id: fallaId },
    data: {
      estado:             EstadoFalla.REHABILITADA,
      fechaRestauracion,
      impactoConfirmado,
    },
  });

  // ---------------------------------------------------------------------------
  // 2. Crear o actualizar IntervaloParoMaquina (solo si hubo paro físico).
  // Si un flujo futuro crea un intervalo provisional para la misma falla, la
  // resolución técnica debe confirmar ese mismo intervalo y no duplicarlo.
  // ---------------------------------------------------------------------------
  let intervalo = null;
  if (
    impactoConfirmado === ImpactoProduccionConfirmado.PARO_PARCIAL ||
    impactoConfirmado === ImpactoProduccionConfirmado.PARO_TOTAL
  ) {
    const inicioParo = input.inicioParo;
    if (!inicioParo) {
      throw new Error(
        `El inicio del paro es obligatorio cuando el impacto es ${impactoConfirmado}.`,
      );
    }

    const porcentajeFinal =
      impactoConfirmado === ImpactoProduccionConfirmado.PARO_TOTAL
        ? 100
        : (input.porcentajeAfectacion ?? null);

    // Determinar calidad del dato:
    // Si es PARO_PARCIAL sin porcentaje → DATO_INCOMPLETO.
    const calidadDato =
      impactoConfirmado === ImpactoProduccionConfirmado.PARO_PARCIAL &&
      porcentajeFinal === null
        ? CalidadDato.DATO_INCOMPLETO
        : CalidadDato.CONFIRMADO;

    const intervaloExistente = await tx.intervaloParoMaquina.findFirst({
      where: {
        fallaId,
        tipo: TipoParo.NO_PLANIFICADO,
      },
      orderBy: { createdAt: "asc" },
    });

    const data = {
      maquinaId,
      fallaId,
      tareaId:             falla.tareaId ?? null,
      tipo:                TipoParo.NO_PLANIFICADO,
      impacto:             impactoConfirmado,
      porcentajeAfectacion: porcentajeFinal,
      calidadDato,
      inicio:              inicioParo,
      fin:                 fechaRestauracion,
      confirmadoPorId:     tecnicoId,
    };

    intervalo = intervaloExistente
      ? await tx.intervaloParoMaquina.update({
          where: { id: intervaloExistente.id },
          data,
        })
      : await tx.intervaloParoMaquina.create({ data });
  }

  return { falla: fallaActualizada, intervalo };
}
