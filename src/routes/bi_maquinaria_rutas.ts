/**
 * routes/bi_maquinaria_rutas.ts
 *
 * Rutas REST para el módulo de métricas de maquinaria (FASE 1).
 * Solo técnicos y coordinadores pueden confirmar/descartar fallas.
 * La resolución se integra en el flujo existente de tickets.
 */

import { Router } from "express";
import { Rol } from "@prisma/client";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import {
  confirmarFallaController,
  descartarFallaController,
} from "../modules/bi_maquinaria/controllers/bi_controller";

const router = Router();

// Confirmar falla: técnico confirma la avería y provee la fecha real.
// Roles permitidos: TECNICO, COORDINADOR_MTTO, JEFE_MTTO, SUPER_ADMIN
router.post(
  "/fallas/:fallaId/confirmar",
  authenticate,
  authorize([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO, Rol.SUPER_ADMIN]),
  confirmarFallaController,
);

// Descartar falla: técnico determina que no hubo avería real.
// Roles permitidos: TECNICO, COORDINADOR_MTTO, JEFE_MTTO, SUPER_ADMIN
router.post(
  "/fallas/:fallaId/descartar",
  authenticate,
  authorize([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO, Rol.SUPER_ADMIN]),
  descartarFallaController,
);

export default router;
