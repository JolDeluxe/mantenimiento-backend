import express from "express";
import http from "http";
import path from "path";
import morgan from 'morgan';
import { env } from "./env";
import { corsMiddleware } from "./middlewares/cors";
import { prisma } from "./db";

// Utilidades del sistema
import { iniciarTareasProgramadas } from './utils/scheduler';
import { inicializarSistema } from "./utils/setup"; 
import { initSocket } from "./utils/socket"; 
import { esperarPushesActivos, getActivePushTaskCount, iniciarShutdownPush } from "./modules/notificaciones/helper";

// Rutas
import auth from "./routes/auth_rutas";
import usuarios from "./routes/usuarios_rutas";
import departamentos from "./routes/departamentos_rutas";
import bitacora from './routes/bitacora_rutas';
import tickets from './routes/tickets_rutas';
import notificaciones from "./routes/notificaciones_rutas";
import dashboard from "./routes/dashboard_rutas";
import maquinas from "./routes/maquinas_rutas";
import recurrencias from "./routes/recurrencias_rutas";
import actividadesRecurrentes from "./routes/actividades_recurrentes_rutas";
import configuracion from "./routes/configuracion_rutas";
import public_rutas from "./routes/public_rutas";
import biMaquinaria from "./routes/bi_maquinaria_rutas";
import diasLaborados from "./routes/dias_laborados_rutas";

const app = express();
const httpServer = http.createServer(app);
let shutdownPromise: Promise<void> | null = null;

const PUSH_SHUTDOWN_TIMEOUT_MS = 5500;
const FORCE_SHUTDOWN_TIMEOUT_MS = 7000;

// --- MIDDLEWARES ---
app.set("trust proxy", 1);
app.use(corsMiddleware); 
app.use(express.json());
app.use(morgan('dev'));

// --- CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ---
app.use(express.static(path.join(__dirname, "../public")));

// --- RUTA BASE (Health Check) ---
app.get("/", (req, res) => {
  res.send("Backend Mantenimiento: ONLINE 🚀");
});

// --- MONTAJE DE RUTAS API ---
app.use("/api/auth", auth);
app.use("/api/usuarios", usuarios);
app.use("/api/departamentos", departamentos);
app.use("/api/bitacora", bitacora);
app.use("/api/tickets", tickets);
app.use("/api/notificaciones", notificaciones);
app.use("/api/dashboard", dashboard);
app.use("/api/maquinas", maquinas);
app.use("/api/recurrencias", recurrencias);
app.use("/api/actividades-recurrentes", actividadesRecurrentes);
app.use("/api/configuracion", configuracion);
app.use("/api/public", public_rutas);
app.use("/api/bi/maquinaria", biMaquinaria);
app.use("/api", diasLaborados);

// --- ARRANQUE DEL SERVIDOR ---

const detachTimer = (timer: ReturnType<typeof setTimeout>) => {
    const maybeTimer = timer as { unref?: unknown };
    if (typeof maybeTimer.unref === "function") {
        maybeTimer.unref();
    }
};

const gracefulShutdown = (reason: "SIGINT" | "SIGTERM" | "PM2_SHUTDOWN_MESSAGE") => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = new Promise<void>((resolve) => {
        console.log(`[SHUTDOWN] ${reason} recibido. Cerrando servidor...`);
        iniciarShutdownPush();

        const forceExitTimer = setTimeout(() => {
            console.error("[SHUTDOWN] Timeout forzado alcanzado. Terminando proceso.");
            process.exit(1);
        }, FORCE_SHUTDOWN_TIMEOUT_MS);
        detachTimer(forceExitTimer);

        httpServer.close(async (error) => {
            if (error) {
                console.error("[SHUTDOWN] Error cerrando servidor HTTP:", error);
            }

            try {
                const pushResult = await esperarPushesActivos(PUSH_SHUTDOWN_TIMEOUT_MS);
                if (!pushResult.completed) {
                    console.warn(
                        `[SHUTDOWN] Timeout esperando Web Push. Pendientes: ${pushResult.pending}.`
                    );
                } else if (getActivePushTaskCount() > 0) {
                    console.warn(
                        `[SHUTDOWN] Web Push reporta tareas pendientes tras la espera: ${getActivePushTaskCount()}.`
                    );
                }
            } catch (pushError) {
                console.error("[SHUTDOWN] Error esperando tareas Web Push:", pushError);
            }

            try {
                await prisma.$disconnect();
            } catch (disconnectError) {
                console.error("[SHUTDOWN] Error cerrando Prisma:", disconnectError);
            }

            clearTimeout(forceExitTimer);
            resolve();
            process.exit(error ? 1 : 0);
        });
    });

    return shutdownPromise;
};

const startServer = async () => {
    try {
        await inicializarSistema();

        initSocket(httpServer);

        httpServer.listen(env.PORT, '0.0.0.0', () => {
            console.log(`Servidor corriendo en http://localhost:${env.PORT}`);
            console.log(`Ambiente: ${env.NODE_ENV}`);
            iniciarTareasProgramadas();
        });

    } catch (error) {
        console.error("❌ Error fatal al iniciar el servidor:", error);
        process.exit(1);
    }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("message", (message) => {
    if (message === "shutdown") {
        gracefulShutdown("PM2_SHUTDOWN_MESSAGE");
    }
});

// Ejecutar
startServer();
