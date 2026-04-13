import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validate } from "../middlewares/validate";
import { Rol } from "@prisma/client";
import { dashboardFiltrosSchema } from "../modules/dashboard/zod";
import { getDashboardKpis } from "../modules/dashboard/01_kpis";

const router = Router();

router.use(authenticate);

// GET /api/dashboard/kpis
router.get(
  "/kpis",
  authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]),
  validate(dashboardFiltrosSchema),
  getDashboardKpis
);

export default router;