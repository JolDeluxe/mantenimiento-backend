// src/modules/dashboard/zod/index.ts
import { z } from "zod";

const preprocessEmpty = (val: unknown) =>
  val === "" || val === "null" || val === "undefined" ? undefined : val;

export const dashboardFiltrosSchema = z.object({
  query: z.object({
    year:           z.preprocess(preprocessEmpty, z.coerce.number().int().min(2020).max(2100).optional()),
    month:          z.preprocess(preprocessEmpty, z.coerce.number().int().min(0).max(12).optional()),
    fechaInicio:    z.preprocess(preprocessEmpty, z.string().optional()),
    fechaFin:       z.preprocess(preprocessEmpty, z.string().optional()),
    departamentoId: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
    tecnicoId:      z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
  }).strict(), 
}); 

export const tecnicoDetalleParamsSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }).strict(),
  query: z.object({
    year:        z.preprocess(preprocessEmpty, z.coerce.number().int().min(2020).max(2100).optional()),
    month:       z.preprocess(preprocessEmpty, z.coerce.number().int().min(0).max(12).optional()),
    fechaInicio: z.preprocess(preprocessEmpty, z.string().optional()),
    fechaFin:    z.preprocess(preprocessEmpty, z.string().optional()),
  }).strict(),
}); // 🚨 CERO .strict() exterior

export type DashboardFiltrosQuery  = z.infer<typeof dashboardFiltrosSchema>["query"];
export type TecnicoDetalleParams   = z.infer<typeof tecnicoDetalleParamsSchema>["params"];
export type TecnicoDetalleQuery    = z.infer<typeof tecnicoDetalleParamsSchema>["query"];