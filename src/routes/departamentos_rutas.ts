import { Router } from "express";
import { Rol } from "@prisma/client";
import { validate } from "../middlewares/validate";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

import { 
  listDepartamentosSchema,
  createDepartamentoSchema, 
  updateDepartamentoSchema, 
  patchDepartamentoSchema,
  getDepartamentoByIdSchema
} from "../modules/departamentos/zod";

import { 
  listDepartamentos, 
  listDepartamentosInactivos, 
  getDepartamentoById 
} from "../modules/departamentos/01_list";

import { createDepartamento } from "../modules/departamentos/02_create";
import { updateDepartamento } from "../modules/departamentos/03_update";
import { patchDepartamentoEstado } from "../modules/departamentos/04_patch";

const router = Router();

// --- RUTAS PÚBLICAS (O HÍBRIDAS) ---

// GET /api/departamentos
// Ahora valida q, page y limit antes de entrar
router.get("/", validate(listDepartamentosSchema), listDepartamentos);

// --- RUTAS PROTEGIDAS ---

router.use(authenticate);

// GET /api/departamentos/inactivos (Solo Admin)
router.get(
  "/inactivos",
  authorize([Rol.SUPER_ADMIN]),
  validate(listDepartamentosSchema), 
  listDepartamentosInactivos
);

// GET /api/departamentos/:id
router.get(
  "/:id", 
  validate(getDepartamentoByIdSchema), 
  getDepartamentoById
);

// POST /api/departamentos
router.post(
  "/", 
  authorize([Rol.SUPER_ADMIN]), 
  validate(createDepartamentoSchema), 
  createDepartamento
);

// PUT /api/departamentos/:id
router.put(
  "/:id", 
  authorize([Rol.SUPER_ADMIN]),
  validate(updateDepartamentoSchema), 
  updateDepartamento
);

// PATCH /api/departamentos/:id
router.patch(
  "/:id", 
  authorize([Rol.SUPER_ADMIN]),
  validate(patchDepartamentoSchema), 
  patchDepartamentoEstado
);

export default router;