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