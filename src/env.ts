import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url({ message: "URL de BD inválida" }), 
    JWT_SECRET: z.string().min(1),
    JWT_ACCESS_EXPIRES: z.string().default("15m"),
    JWT_REFRESH_EXPIRES: z.string().default("1y"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    
    SYS_DEPTO_CRITICO: z.string().min(1).default("Mantenimiento"),
    SYS_ADMIN_USER: z.string().min(1).default("SUPER_ADMIN"),
    SYS_ADMIN_PASS: z.string().min(1), 

    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),

    // --- VALIDACIÓN DE CORREO ---
    SMTP_HOST: z.string().default("smtp.office365.com"),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().email({ message: "Correo SMTP inválido" }),
    SMTP_PASS: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});