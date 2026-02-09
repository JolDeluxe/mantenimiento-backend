import { prisma } from "../../db";
import { Estatus } from "@prisma/client";
import { env } from "../../env";

export const validarNombreUnico = async (nombre: string): Promise<boolean> => {
  const existe = await prisma.departamento.findUnique({
    where: { nombre },
  });
  return !existe;
};

export const validarProteccionDepartamento = (
  departamentoActual: { nombre: string },
  datosNuevos: { nombre?: string, estado?: Estatus | string }
) => {
  if (departamentoActual.nombre === env.SYS_DEPTO_CRITICO) {
    
    if (datosNuevos.nombre && datosNuevos.nombre.trim() !== env.SYS_DEPTO_CRITICO) {
      throw new Error(`El departamento '${env.SYS_DEPTO_CRITICO}' es crítico y no puede ser renombrado.`);
    }

    if (datosNuevos.estado === Estatus.INACTIVO) {
      throw new Error(`El departamento '${env.SYS_DEPTO_CRITICO}' no puede ser desactivado.`);
    }
  }
};