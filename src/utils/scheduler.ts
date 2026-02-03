import cron from 'node-cron';
import { prisma } from '../db';

//este archivo se encarga de las tareas programadas (cron jobs) del sistema
// Este trabajo se ejecuta diariamente para limpiar la bitácora antigua

export const iniciarTareasProgramadas = () => {
  // Ejecutar todos los días a las 03:00 AM (hora del servidor)
  cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Iniciando limpieza de bitácora antigua...');
    
    // 6 meses 
    const diasRetencion = 180; 
    
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - diasRetencion);

    try {
      // ESTO ES LO QUE BORRA FÍSICAMENTE LOS DATOS DE MYSQL
      const borrados = await prisma.bitacora.deleteMany({
        where: {
          createdAt: {
            lt: fechaLimite
          }
        }
      });
      
      if (borrados.count > 0) {
        console.log(`[CRON] Limpieza completada. Se eliminaron ${borrados.count} registros de hace más de 6 meses.`);
      } else {
        console.log('[CRON] Todo limpio. No había registros tan antiguos.');
      }
    } catch (error) {
      console.error('[CRON ERROR] Falló la limpieza de bitácora:', error);
    }
  });
  
  console.log('[SYSTEM] Tareas programadas (CRON) inicializadas: Limpieza a las 03:00 AM.');
};