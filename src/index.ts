import express from "express";
import path from "path";
import morgan from 'morgan';
import { env } from "./env";
import { corsMiddleware } from "./middlewares/cors";

// Utilidades del sistema
import { iniciarTareasProgramadas } from './utils/scheduler';
import { inicializarSistema } from "./utils/setup"; 

// Rutas
import auth from "./routes/auth_rutas";
import usuarios from "./routes/usuarios_rutas";
import departamentos from "./routes/departamentos_rutas";
import bitacora from './routes/bitacora_rutas';
import tickets from './routes/tickets_rutas';

const app = express();

// --- MIDDLEWARES ---
app.use(express.json());
app.use(corsMiddleware);
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

// --- ARRANQUE DEL SERVIDOR ---

const startServer = async () => {
  try {
    await inicializarSistema();

    app.listen(env.PORT, () => {
      console.log(`🔥 Servidor corriendo en http://localhost:${env.PORT}`);
      console.log(`🛡️  Ambiente: ${env.NODE_ENV}`);
      
      iniciarTareasProgramadas();
    });

  } catch (error) {
    console.error("❌ Error fatal al iniciar el servidor:", error);
    process.exit(1);
  }
};

// Ejecutar
startServer();