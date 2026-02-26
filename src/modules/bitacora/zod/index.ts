import { z } from "zod";

export const listBitacoraSchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(500).default(100),
    tipo: z.enum(['errores', 'acciones']).optional(),
    usuarioId: z.coerce.number().int().positive().optional(),
    
    // Ordenamiento dinámico compatible con Prisma
    sort: z.preprocess(
      (val) => {
        if (typeof val === "string") {
          try { return JSON.parse(val); } catch (e) { return []; }
        }
        return val;
      },
      z.array(
        z.object({
          createdAt: z.enum(["asc", "desc"]).optional(),
          accion: z.enum(["asc", "desc"]).optional(),
        }).strict()
      )
    ).default([{ createdAt: "desc" }])
  }),
});

export type ListBitacoraQuery = z.infer<typeof listBitacoraSchema>["query"];