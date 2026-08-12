import cors from "cors";

const whitelist = [
  // Desarrollo local
  "http://localhost:5000",
  "http://localhost:5001",
  "http://localhost:3000",

  // Red local
  "http://200.1.0.72:5000",
  "http://200.1.0.72:5001",

  // Frontends anteriores de Netlify
  "https://cuadra-mantenimiento.netlify.app",
  "https://cuadra-mbc-mantenimiento-interno.netlify.app",
  "https://cuadra-mbc-mantenimiento-publico.netlify.app",
  "https://tutorial-mantenimiento.netlify.app",

  // Nuevos dominios
  "https://mantenimiento.mbc-bitacoras.me",
  "https://mantenimiento-interno.mbc-bitacoras.me",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Permite peticiones sin Origin, por ejemplo Postman o servidor-servidor
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
      return;
    }

    console.error(`❌ Bloqueado por CORS: ${origin}`);
    callback(new Error("No permitido por CORS"));
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Idempotency-Key",
  ],

  optionsSuccessStatus: 204,
};

export const corsMiddleware = cors(corsOptions);