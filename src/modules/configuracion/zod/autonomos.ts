import { z } from "zod";

export const patchAutonomosConfigSchema = z.object({
  body: z.object({
    habilitado: z.boolean(),
  }),
});
