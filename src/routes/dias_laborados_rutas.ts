import { Router } from "express";
import { Rol } from "@prisma/client";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { DiasLaboradosController } from "../modules/dias_laborados/controllers/dias_laborados_controller";

const router = Router();

router.use(authenticate);
router.use(authorize([Rol.SUPER_ADMIN]));

router.get("/dias-laborados", DiasLaboradosController.obtener);

export default router;
