import { prisma } from '../db';

export const registrarAccion = async (accion: string, usuarioId: number | null, detalles?: string) => {
  try {
    await prisma.bitacora.create({
      data: {
        accion: accion.toUpperCase(),
        usuarioId,
        detalles
      }
    });
  } catch (logError) {
    console.error(`[LOGGER CRITICAL FAIL] No se pudo guardar la acción: ${accion}`, logError);
  }
};

export const registrarError = async (contexto: string, usuarioId: number | null, error: any) => {
  try {
    // Extraemos el mensaje real del error, sea cual sea el tipo
    const mensajeTecnico = error instanceof Error ? error.stack || error.message : JSON.stringify(error);
    
    await prisma.bitacora.create({
      data: {
        accion: `ERROR: ${contexto.toUpperCase()}`, 
        usuarioId,
        detalles: mensajeTecnico
      }
    });
    
    // También lo mostramos en la consola del servidor para desarrollo
    console.error(`[ERROR REGISTRADO] ${contexto}:`, error);
    
  } catch (logError) {
    console.error(`[LOGGER CRITICAL FAIL] No se pudo guardar el error de: ${contexto}`, logError);
  }
};