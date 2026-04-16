import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validate } from "../middlewares/validate";
import { Rol } from "@prisma/client";
import { dashboardFiltrosSchema, tecnicoDetalleParamsSchema } from "../modules/dashboard/zod";
import { getKpisGeneral } from "../modules/dashboard/01_kpis_general";
import { getKpisArea } from "../modules/dashboard/02_kpis_area";
import { getKpisEquipo } from "../modules/dashboard/03_kpis_equipo";
import { getTecnicoDetalle } from "../modules/dashboard/04_tecnico_detalle"; 

const router = Router();

router.use(authenticate);

const rolesPermitidos = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];

// GET /api/dashboard/kpis/general
router.get(
  "/kpis/general",
  authorize(rolesPermitidos),
  validate(dashboardFiltrosSchema),
  getKpisGeneral
);

// GET /api/dashboard/kpis/area
router.get(
  "/kpis/area",
  authorize(rolesPermitidos),
  validate(dashboardFiltrosSchema),
  getKpisArea
);

// GET /api/dashboard/kpis/equipo
router.get(
  "/kpis/equipo",
  authorize(rolesPermitidos),
  validate(dashboardFiltrosSchema),
  getKpisEquipo
);

// GET /api/dashboard/tecnico/:id/kpis
router.get(
  "/tecnico/:id/kpis",
  authorize(rolesPermitidos),
  validate(tecnicoDetalleParamsSchema),
  getTecnicoDetalle
);

export default router;