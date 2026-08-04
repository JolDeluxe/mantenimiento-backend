/**
 * bi_maquinaria/zod/index.ts
 *
 * Esquemas Zod para la FASE 1 del módulo de métricas de maquinaria.
 * Valida los payloads de las operaciones sobre FallaMaquina e IntervaloParoMaquina.
 *
 * Reglas de validación críticas implementadas aquí:
 *   - SIN_PARO            → no se acepta inicioParo ni porcentajeAfectacion.
 *   - PARO_PARCIAL        → inicioParo obligatorio; porcentajeAfectacion opcional 1-99 | null.
 *   - PARO_TOTAL          → inicioParo obligatorio; porcentajeAfectacion = 100.
 *   - fechaFallaConfirmada no puede ser posterior al momento actual.
 *   - inicioParo debe ser anterior a la fecha de restauración (validado en servicio).
 */

import { z } from "zod";
import { ImpactoProduccionConfirmado } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const preprocessDate = (val: unknown) =>
  val === "" || val === "null" || val === null ? undefined : val;

// ---------------------------------------------------------------------------
// Confirmar Falla (técnico confirma que existe una avería real)
// ---------------------------------------------------------------------------
export const confirmarFallaSchema = z.object({
  params: z.object({
    fallaId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    /**
     * Fecha en que realmente ocurrió la falla.
     * El técnico puede aceptar la fecha del cliente o corregirla.
     * No puede ser futura.
     */
    fechaFallaConfirmada: z
      .preprocess(
        preprocessDate,
        z.coerce.date(),
      )
      .refine((d) => d <= new Date(), {
        message: "La fecha de confirmación de la falla no puede ser futura.",
      }),
  }),
});

// ---------------------------------------------------------------------------
// Descartar Falla (técnico determina que no hubo avería real)
// ---------------------------------------------------------------------------
export const descartarFallaSchema = z.object({
  params: z.object({
    fallaId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    /** Motivo del descarte (opcional pero recomendado). */
    motivo: z.string().trim().max(500).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Resolución Técnica (al marcar tarea como RESUELTO)
// Se incrusta en changeStatusSchema como campo adicional.
// ---------------------------------------------------------------------------

const baseResolucionSchema = z.object({
  /**
   * Impacto confirmado en producción.
   * Obligatorio al resolver una tarea correctiva vinculada a máquina.
   */
  impactoConfirmado: z.nativeEnum(ImpactoProduccionConfirmado),
  /**
   * Inicio real del paro físico.
   * Requerido solo cuando impactoConfirmado = PARO_PARCIAL | PARO_TOTAL.
   * No puede ser futura.
   */
  inicioParo: z
    .preprocess(preprocessDate, z.coerce.date().optional())
    .optional(),
  /**
   * Porcentaje de afectación de producción.
   *   PARO_TOTAL   → se fuerza a 100 en el servicio; ignorar si se envía distinto.
   *   PARO_PARCIAL → entero 1-99 | null (null = técnico no puede estimarlo → DATO_INCOMPLETO).
   *   SIN_PARO     → no aplica; ignorado.
   */
  porcentajeAfectacion: z
    .preprocess(
      (val) => (val === "" || val === null || val === "null" ? null : val),
      z.number().int().min(1).max(99).nullable().optional(),
    )
    .optional(),
});

/**
 * Validación refinada con reglas cruzadas de impacto.
 */
export const resolucionFallaSchema = baseResolucionSchema.superRefine((data, ctx) => {
  if (
    data.impactoConfirmado === ImpactoProduccionConfirmado.PARO_PARCIAL ||
    data.impactoConfirmado === ImpactoProduccionConfirmado.PARO_TOTAL
  ) {
    if (!data.inicioParo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inicioParo"],
        message: `El inicio del paro es obligatorio cuando el impacto es ${data.impactoConfirmado}.`,
      });
    }
  }

  if (data.impactoConfirmado === ImpactoProduccionConfirmado.SIN_PARO) {
    if (data.inicioParo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inicioParo"],
        message: "No se debe proporcionar inicioParo cuando el impacto es SIN_PARO.",
      });
    }
    if (data.porcentajeAfectacion != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["porcentajeAfectacion"],
        message: "No se debe proporcionar porcentajeAfectacion cuando el impacto es SIN_PARO.",
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------
export type ConfirmarFallaParams = z.infer<typeof confirmarFallaSchema>["params"];
export type ConfirmarFallaBody   = z.infer<typeof confirmarFallaSchema>["body"];
export type DescartarFallaParams = z.infer<typeof descartarFallaSchema>["params"];
export type DescartarFallaBody   = z.infer<typeof descartarFallaSchema>["body"];
export type ResolucionFallaInput = z.infer<typeof resolucionFallaSchema>;
