import express from "express";
import http from "http";
import path from "path";
import morgan from 'morgan';
import { env } from "./env";
import { corsMiddleware } from "./middlewares/cors";

// Utilidades del sistema
import { iniciarTareasProgramadas } from './utils/scheduler';
import { inicializarSistema } from "./utils/setup"; 
import { initSocket } from "./utils/socket"; 

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

const app = express();
const httpServer = http.createServer(app);

// --- MIDDLEWARES ---
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

// --- ARRANQUE DEL SERVIDOR ---

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

// Ejecutar
startServer();
