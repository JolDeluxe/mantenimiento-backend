import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validate } from "../middlewares/validate";
import { Rol } from "@prisma/client";
import { dashboardFiltrosSchema, tecnicoDetalleParamsSchema } from "../modules/dashboard/zod";
import { getKpisGeneral }    from "../modules/dashboard/01_kpis_general";
import { getKpisArea }       from "../modules/dashboard/02_kpis_area";
import { getKpisEquipo }     from "../modules/dashboard/03_kpis_equipo";
import { getTecnicoDetalle } from "../modules/dashboard/04_tecnico_detalle";
import { getKpiPrincipal }  from "../modules/dashboard/05_kpi_principal";

const router = Router();
router.use(authenticate);

const rolesReportes  = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const rolesPrincipal = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO, Rol.TECNICO];

// GET /api/dashboard/kpis/principal
// DEBE ir antes de rutas parametrizadas /:id
router.get(
  "/kpis/principal",
  authorize(rolesPrincipal),
  getKpiPrincipal
);

// GET /api/dashboard/kpis/general
router.get(
  "/kpis/general",
  authorize(rolesReportes),
  validate(dashboardFiltrosSchema),
  getKpisGeneral
);

// GET /api/dashboard/kpis/area
router.get(
  "/kpis/area",
  authorize(rolesReportes),
  validate(dashboardFiltrosSchema),
  getKpisArea
);

// GET /api/dashboard/kpis/equipo
router.get(
  "/kpis/equipo",
  authorize(rolesReportes),
  validate(dashboardFiltrosSchema),
  getKpisEquipo
);

// GET /api/dashboard/tecnico/:id/kpis
router.get(
  "/tecnico/:id/kpis",
  authorize([...rolesReportes, Rol.TECNICO]), // <-- Corrección aquí
  validate(tecnicoDetalleParamsSchema),
  getTecnicoDetalle
);

export default router;