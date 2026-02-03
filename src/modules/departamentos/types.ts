import { z } from "zod";
import { 
  createDepartamentoSchema, 
  updateDepartamentoSchema, 
  patchDepartamentoSchema 
} from "./zod";

export type CreateDepartamentoInput = z.infer<typeof createDepartamentoSchema>["body"];
export type UpdateDepartamentoInput = z.infer<typeof updateDepartamentoSchema>["body"];
export type PatchDepartamentoInput = z.infer<typeof patchDepartamentoSchema>["body"];