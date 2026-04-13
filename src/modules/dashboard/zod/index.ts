import { z } from "zod";

const preprocessEmpty = (val: unknown) =>
  val === "" || val === "null" ? undefined : val;

export const dashboardFiltrosSchema = z.object({
  query: z.object({
    year: z.preprocess(preprocessEmpty, z.coerce.number().int().min(2020).max(2100).optional()),
    month: z.preprocess(preprocessEmpty, z.coerce.number().int().min(0).max(12).optional()),
    departamentoId: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
    tecnicoId: z.preprocess(preprocessEmpty, z.coerce.number().int().positive().optional()),
  }),
});

export type DashboardFiltrosQuery = z.infer<typeof dashboardFiltrosSchema>["query"];