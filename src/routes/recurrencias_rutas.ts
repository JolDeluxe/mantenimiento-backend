// src/routes/recurrencias_rutas.ts
import { Router } from "express";
import { Rol } from "@prisma/client";
import { validate } from "../middlewares/validate";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

import {
  createReglaSchema,
  updateReglaSchema,
  reglaIdSchema,
  maquinaIdSchema,
  proyeccionesQuerySchema,
  proyeccionReglaQuerySchema,
  materializeSchema,
} from "../modules/recurrencias/zod";

import { listarReglasPorMaquina, getReglaById } from "../modules/recurrencias/01_list";
import { createRegla }      from "../modules/recurrencias/02_create";
import { updateRegla }      from "../modules/recurrencias/03_update";
import { deleteRegla }      from "../modules/recurrencias/04_delete";
import { getProyeccionesGlobal, getProyeccionRegla } from "../modules/recurrencias/05_proyecciones";
import { materializeRegla } from "../modules/recurrencias/06_materialize";

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Roles con acceso de escritura: SUPER_ADMIN, JEFE_MTTO, COORDINADOR_MTTO
const rolesGestion = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];

// ---------------------------------------------------------------------------
// RUTAS MONTADAS en /api/recurrencias
// ---------------------------------------------------------------------------

// GET /api/recurrencias/proyecciones?year=2026
// IMPORTANTE: esta ruta debe ir ANTES de /:id para no confundir "proyecciones" como ID
router.get(
  "/proyecciones",
  validate(proyeccionesQuerySchema),
  getProyeccionesGlobal,
);

// GET /api/recurrencias/:id
router.get(
  "/:id",
  validate(reglaIdSchema),
  getReglaById,
);

// GET /api/recurrencias/:id/proyeccion?year=2026
router.get(
  "/:id/proyeccion",
  validate(proyeccionReglaQuerySchema),
  getProyeccionRegla,
);

// POST /api/recurrencias — Crear nueva regla
router.post(
  "/",
  authorize(rolesGestion),
  validate(createReglaSchema),
  createRegla,
);

// PUT /api/recurrencias/:id — Actualizar regla
router.put(
  "/:id",
  authorize(rolesGestion),
  validate(updateReglaSchema),
  updateRegla,
);

// DELETE /api/recurrencias/:id — Baja lógica (activo = false)
router.delete(
  "/:id",
  authorize(rolesGestion),
  validate(reglaIdSchema),
  deleteRegla,
);

// POST /api/recurrencias/:id/materialize — Materializar un ciclo
router.post(
  "/:id/materialize",
  authorize(rolesGestion),
  validate(materializeSchema),
  materializeRegla,
);

export default router;
