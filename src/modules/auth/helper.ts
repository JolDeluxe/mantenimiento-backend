import { prisma } from "../../db";

export const validarDepartamentoRegistro = async (departamentoId: number | null | undefined) => {
  if (!departamentoId) return { valido: true };

  const departamento = await prisma.departamento.findUnique({
    where: { id: departamentoId }
  });

  if (!departamento) {
    return { valido: false, message: "El departamento seleccionado no existe." };
  }

  if (departamento.nombre === "Mantenimiento") {
    return { 
      valido: false, 
      message: "Registro restringido: El departamento de Mantenimiento requiere alta administrativa.",
      esMantenimiento: true
    };
  }

  return { valido: true };
};