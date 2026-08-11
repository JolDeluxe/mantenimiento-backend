import cors from "cors";
import { env } from "../env";

const whitelist = [
  "http://localhost:5000",
  "http://localhost:5001",
  "http://localhost:3000",

  "http://200.1.0.72:5000",
  "http://200.1.0.72:5001",
  // Aquí agregaremos luego los dominios de Netlify:
  "https://cuadra-mantenimiento.netlify.app",
  "https://cuadra-mbc-mantenimiento-interno.netlify.app",
  "https://cuadra-mbc-mantenimiento-publico.netlify.app",
  "https://tutorial-mantenimiento.netlify.app"
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
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
  optionsSuccessStatus: 204, 
};

export const corsMiddleware = cors(corsOptions);
