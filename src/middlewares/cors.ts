import cors from "cors";
import { env } from "../env";

const whitelist = [
  "http://localhost:5000",
  "http://localhost:5001",
  "http://localhost:3000",

  "http://200.1.0.72:5000",
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