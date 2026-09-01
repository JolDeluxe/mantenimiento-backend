import cron from "node-cron";
import { prisma } from "../db";
import { autoCloseResolvedTickets, enviarAdvertenciasFinTurno, ejecutarAutoPausaFinTurno } from "../modules/tickets/automations";
import { procesarRecurrenciasProgramadas } from "../modules/recurrencias/automations";
import { procesarActividadesRecurrentesProgramadas } from "../modules/actividades_recurrentes/automations";
import { procesarIngestaMaquinariaCsv } from "./maquinaria-csv-ingest";
import { env } from "../env";
import { TURNO_TIMEZONE } from "../modules/tickets/turno-config";

type RecurrenceSchedule = (
  expression: string,
  task: () => void | Promise<void>,
  options: { timezone: string },
) => unknown;

type RecurrenceHandlers = {
  procesarRecurrenciasProgramadas: () => Promise<unknown>;
  procesarActividadesRecurrentesProgramadas: () => Promise<unknown>;
};

export const programarRecurrencias = (
  schedule: RecurrenceSchedule = cron.schedule,
  handlers: RecurrenceHandlers = {
    procesarRecurrenciasProgramadas,
    procesarActividadesRecurrentesProgramadas,
  },
) => {
  // Registrar el CRON no ejecuta el callback; node-cron lo invoca al llegar la hora configurada.
  schedule("0 2 * * *", async () => {
    console.log("[CRON] Ejecutando automatización de las 02:00 AM...");
    try {
      await handlers.procesarRecurrenciasProgramadas();
    } catch (error) {
      console.error("[CRON ERROR] Falló la automatización de recurrencias de maquinaria:", error);
    }
    try {
      await handlers.procesarActividadesRecurrentesProgramadas();
    } catch (error) {
      console.error("[CRON ERROR] Falló la automatización de actividades recurrentes:", error);
    }
  }, { timezone: TURNO_TIMEZONE });
};

export const iniciarTareasProgramadas = () => {
  // CRON 0: Mantenimientos y actividades recurrentes automáticas
  // Ejecuta todos los días a las 02:00 AM (America/Mexico_City)
  programarRecurrencias();

  // CRON 1: Cierre automático de tickets resueltos inactivos
  // Ejecuta todos los días a la 01:00 AM (America/Mexico_City)
  cron.schedule("0 1 * * *", async () => {
  // cron.schedule("* * * * *", async () => { // Los 5 asteriscos significan "cada minuto"

    console.log("[CRON] Iniciando evaluación de cierre automático de tickets...");
    try {
      await autoCloseResolvedTickets();
      console.log("[CRON] Evaluación de tickets finalizada.");
    } catch (error) {
      console.error("[CRON ERROR] Falló el cierre automático de tickets:", error);
    }
  }, { timezone: TURNO_TIMEZONE });

  // CRON 2: Ingesta diaria de maquinaria ERP
  // Ejecuta todos los días a las 03:00 AM (America/Mexico_City)
  cron.schedule("0 3 * * *", async () => {
    if (!env.MAQUINARIA_CSV_FILE_PATH) {
      console.warn("[CRON] Ingesta maquinaria omitida: MAQUINARIA_CSV_FILE_PATH no está configurado.");
      return;
    }

    console.log("[CRON] Iniciando ingesta diaria de maquinaria ERP...");
    try {
      await procesarIngestaMaquinariaCsv({ apply: true });
      console.log("[CRON] Ingesta diaria de maquinaria ERP finalizada.");
    } catch (error) {
      console.error("[CRON ERROR] Falló la ingesta diaria de maquinaria ERP:", error);
    }
  }, { timezone: TURNO_TIMEZONE });

  // CRON 3: Limpieza de bitácora antigua
  // Ejecuta todos los días a las 03:30 AM (America/Mexico_City)
  cron.schedule("30 3 * * *", async () => {
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
  }, { timezone: TURNO_TIMEZONE });

  // CRON 4: Advertencia de fin de turno a las 17:15 (Lunes a Viernes) y 13:45 (Sábados)
  cron.schedule("15 17 * * 1-5", async () => {
    console.log("[CRON] Ejecutando advertencia de fin de turno de Lunes a Viernes (17:15)...");
    await enviarAdvertenciasFinTurno();
  }, { timezone: TURNO_TIMEZONE });

  cron.schedule("45 13 * * 6", async () => {
    console.log("[CRON] Ejecutando advertencia de fin de turno de Sábados (13:45)...");
    await enviarAdvertenciasFinTurno();
  }, { timezone: TURNO_TIMEZONE });

  // CRON 5: Auto-pausa de fin de turno. Ejecuta 15 minutos después del fin oficial.
  cron.schedule("45 17 * * 1-5", async () => {
    console.log("[CRON] Ejecutando auto-pausa de fin de turno de Lunes a Viernes (17:45, corte 17:30)...");
    await ejecutarAutoPausaFinTurno({ tipoJornada: "SEMANA" });
  }, { timezone: TURNO_TIMEZONE });

  cron.schedule("15 14 * * 6", async () => {
    console.log("[CRON] Ejecutando auto-pausa de fin de turno de Sábados (14:15, corte 14:00)...");
    await ejecutarAutoPausaFinTurno({ tipoJornada: "SABADO" });
  }, { timezone: TURNO_TIMEZONE });
  
  console.log("[SYSTEM] Tareas programadas (CRON) inicializadas: Tickets (01:00) | Recurrencias Maquinaria (02:00) | Actividades Recurrentes (02:00) | Maquinaria ERP (03:00) | Bitácora (03:30) | Advertencia (17:15 / 13:45) | Auto-pausa (17:45 / 14:15).");
};
