import { z } from "zod";

export const subscriptionSchema = z.object({
  body: z.object({
    endpoint: z.string().url({ message: "El endpoint debe ser una URL válida" }),
    keys: z.object({
      p256dh: z.string({ message: "Falta la llave p256dh" }),
      auth: z.string({ message: "Falta la llave auth" }),
    }),
  }),
});

export const listNotificacionesSchema = z.object({
  query: z.object({
    page:         z.coerce.number().min(1).default(1),
    limit:        z.coerce.number().min(1).max(100).default(20),
    soloNoLeidas: z.preprocess((v) => v === "true" || v === true, z.boolean().default(false)),
    tipo:         z.string().optional(),
  }),
});

export const markReadSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export const markActionedSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export type SubscriptionInput       = z.infer<typeof subscriptionSchema>["body"];
export type ListNotificacionesQuery = z.infer<typeof listNotificacionesSchema>["query"];
export type MarkReadParams          = z.infer<typeof markReadSchema>["params"];
export type MarkActionedParams      = z.infer<typeof markActionedSchema>["params"];