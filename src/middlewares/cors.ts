import cors from "cors";
import { env } from "../env";

const whitelist = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
  // Aquí agregaremos luego los dominios de Netlify:
  // "https://cuadra-mantenimiento.netlify.app",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.error(`❌ Bloqueado por CORS: ${origin}`);
      callback(new Error("No permitido por CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

export const corsMiddleware = cors(corsOptions);