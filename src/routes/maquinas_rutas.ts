import { Router } from "express";
import { Rol } from "@prisma/client";
import { validate } from "../middlewares/validate";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

import {
  listMaquinasSchema,
  createMaquinaSchema,
  updateMaquinaSchema,
  patchMaquinaSchema,
  getMaquinaByIdSchema,
  getMaquinaPrefillSchema,
  kpisMaquinaSchema
} from "../modules/maquinas/zod";

import {
  listarMaquinas,
  getMaquinaById,
  getMaquinaPrefill,
  getMaquinaKPIs
} from "../modules/maquinas/01_list";

import { createMaquina } from "../modules/maquinas/02_create";
import { updateMaquina } from "../modules/maquinas/03_update";
import { patchMaquinaEstado } from "../modules/maquinas/04_patch";

const router = Router();

// Todas las rutas requieren autenticación básica
router.use(authenticate);

// --- RUTAS DE LECTURA (Todos los roles autenticados tienen acceso) ---

// GET /api/maquinas
router.get("/", validate(listMaquinasSchema), listarMaquinas);

// GET /api/maquinas/codigo/:codigo/prefill (Para lectura de códigos QR)
router.get("/codigo/:codigo/prefill", validate(getMaquinaPrefillSchema), getMaquinaPrefill);

// GET /api/maquinas/:id/kpis
router.get("/:id/kpis", validate(kpisMaquinaSchema), getMaquinaKPIs);

// GET /api/maquinas/:id
router.get("/:id", validate(getMaquinaByIdSchema), getMaquinaById);


// --- RUTAS DE ESCRITURA/INTERACCIÓN (Todos menos TECNICO y CLIENTE_INTERNO) ---
const rolesAutorizados = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];

// POST /api/maquinas
router.post(
  "/",
  authorize(rolesAutorizados),
  validate(createMaquinaSchema),
  createMaquina
);

// PUT /api/maquinas/:id
router.put(
  "/:id",
  authorize(rolesAutorizados),
  validate(updateMaquinaSchema),
  updateMaquina
);

// PATCH /api/maquinas/:id/estado
router.patch(
  "/:id/estado",
  authorize(rolesAutorizados),
  validate(patchMaquinaSchema),
  patchMaquinaEstado
);

export default router;
