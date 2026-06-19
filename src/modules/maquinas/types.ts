// src/modules/maquinas/types.ts
import { Prisma } from "@prisma/client";

export type MaquinaWithDepartamento = Prisma.MaquinaGetPayload<{
  include: { departamento: true };
}>;
