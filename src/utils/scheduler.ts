import cron from "node-cron";
import { prisma } from "../db";
import { autoCloseResolvedTickets, enviarAdvertenciasFinTurno, ejecutarAutoPausaFinTurno } from "../modules/tickets/automations";
import { procesarRecurrenciasProgramadas } from "../modules/recurrencias/automations";

export const iniciarTareasProgramadas = () => {
  // CRON 0: Mantenimientos recurrentes automáticos (Frecuencias del módulo de preventivos)
  // Ejecuta todos los días a las 02:00 AM (hora del servidor)
  cron.schedule("0 2 * * *", async () => {
    try {
      await procesarRecurrenciasProgramadas();
    } catch (error) {
      console.error("[CRON ERROR] Falló la automatización de recurrencias:", error);
    }
  });

  // CRON 1: Cierre automático de tickets resueltos inactivos
  // Ejecuta todos los días a la 01:00 AM (hora del servidor)
  cron.schedule("0 1 * * *", async () => {
  // cron.schedule("* * * * *", async () => { // Los 5 asteriscos significan "cada minuto"

    console.log("[CRON] Iniciando evaluación de cierre automático de tickets...");
    try {
      await autoCloseResolvedTickets();
      console.log("[CRON] Evaluación de tickets finalizada.");
    } catch (error) {
      console.error("[CRON ERROR] Falló el cierre automático de tickets:", error);
    }
  });

  // CRON 2: Limpieza de bitácora antigua
  // Ejecuta todos los días a las 03:00 AM (hora del servidor)
  cron.schedule("0 3 * * *", async () => {
    console.log("[CRON] Iniciando limpieza de bitácora antigua...");
    
    const diasRetencion = 180; 
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - diasRetencion);

    try {
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
        console.log("[CRON] Todo limpio. No había registros tan antiguos en bitácora.");
      }
    } catch (error) {
      console.error("[CRON ERROR] Falló la limpieza de bitácora:", error);
    }
  });

  // CRON 3: Advertencia de fin de turno a las 17:45 (Lunes a Viernes) y 14:15 (Sábados)
  cron.schedule("45 17 * * 1-5", async () => {
    console.log("[CRON] Ejecutando advertencia de fin de turno de Lunes a Viernes (17:45)...");
    await enviarAdvertenciasFinTurno();
  });

  cron.schedule("15 14 * * 6", async () => {
    console.log("[CRON] Ejecutando advertencia de fin de turno de Sábados (14:15)...");
    await enviarAdvertenciasFinTurno();
  });

  // CRON 4: Auto-Pausa y recorte de tiempo a las 22:00 (Lunes a Sábado) - Tiempo de colchón
  cron.schedule("0 22 * * 1-6", async () => {
    console.log("[CRON] Ejecutando Auto-Pausa implacable con colchón (22:00)...");
    await ejecutarAutoPausaFinTurno();
  });
  
  console.log("[SYSTEM] Tareas programadas (CRON) inicializadas: Recurrentes (02:00 AM) | Tickets (01:00 AM) | Bitácora (03:00 AM) | Turno (17:45/14:15/22:00).");
};