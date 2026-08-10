import { z } from "zod";

export const diasLaboradosQuerySchema = z.object({
  periodo: z.enum(["SEMANA", "MES", "ANIO"]),
  anio: z.coerce.number().int().min(2000).max(2100),
  semana: z.coerce.number().int().min(1).max(53).optional().nullable(),
  mes: z.coerce.number().int().min(1).max(12).optional().nullable(),
}).refine((data) => {
  if (data.periodo === "SEMANA" && !data.semana) {
    return false;
  }
  if (data.periodo === "MES" && !data.mes) {
    return false;
  }
  return true;
}, {
  message: "Faltan parámetros requeridos para el periodo seleccionado (semana o mes)",
  path: ["periodo"]
});

export type DiasLaboradosQuery = z.infer<typeof diasLaboradosQuerySchema>;
