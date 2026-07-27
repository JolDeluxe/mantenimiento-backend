import { Router } from "express";
import { Rol } from "@prisma/client";
import { validate } from "../middlewares/validate";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

import { patchAutonomosConfigSchema } from "../modules/configuracion/zod/autonomos";
import { getAutonomosConfig, patchAutonomosConfig } from "../modules/configuracion/autonomos";

const router = Router();

// Todas las rutas de configuración requieren autenticación y rol de SUPER_ADMIN
router.use(authenticate);
router.use(authorize([Rol.SUPER_ADMIN]));

// GET /api/configuracion/autonomos
router.get("/autonomos", getAutonomosConfig);

// PATCH /api/configuracion/autonomos
router.patch("/autonomos", validate(patchAutonomosConfigSchema), patchAutonomosConfig);

export default router;
