import { prisma } from "../../db";
import { env } from "../../env";

export const validarDepartamentoRegistro = async (departamentoId: number | null | undefined) => {
  if (!departamentoId) return { valido: true };

  const departamento = await prisma.departamento.findUnique({
    where: { id: departamentoId }
  });

  if (!departamento) {
    return { valido: false, message: "El departamento seleccionado no existe." };
  }

  if (departamento.nombre === env.SYS_DEPTO_CRITICO) {
    return {
      valido: false,
      message: "Registro restringido: El departamento de Mantenimiento requiere alta administrativa.",
      esMantenimiento: true
    };
  }

  return { valido: true };
};

/**
 * Convierte un string de expiración tipo ms (ej: '50y', '10y', '30d', '8h', '15m') a un objeto Date futuro.
 * Soporta las unidades básicas de ms y extensiones para años ('y').
 */
export const calculateTokenExpirationDate = (expiresInStr: string): Date => {
  const match = expiresInStr.trim().match(/^(\d+)([a-zA-Z]+)$/);
  if (!match || !match[1] || !match[2]) {
    // Fallback: 1 año por defecto si el formato no coincide
    const fallbackDate = new Date();
    fallbackDate.setFullYear(fallbackDate.getFullYear() + 1);
    return fallbackDate;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const date = new Date();

  switch (unit) {
    case 'y':
    case 'year':
    case 'years':
      date.setFullYear(date.getFullYear() + value);
      break;
    case 'm':
    case 'month':
    case 'months':
      date.setMonth(date.getMonth() + value);
      break;
    case 'd':
    case 'day':
    case 'days':
      date.setDate(date.getDate() + value);
      break;
    case 'h':
    case 'hour':
    case 'hours':
      date.setHours(date.getHours() + value);
      break;
    case 'ms':
      date.setTime(date.getTime() + value);
      break;
    case 's':
    case 'sec':
    case 'seconds':
      date.setSeconds(date.getSeconds() + value);
      break;
    default:
      // Fallback a 1 año
      date.setFullYear(date.getFullYear() + 1);
  }

  return date;
};