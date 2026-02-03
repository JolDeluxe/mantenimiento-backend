import { Router } from "express";
import { getBitacora } from "../modules/bitacora/01_list";
import { authenticate } from "../middlewares/authenticate";

const router = Router();

// GET /api/bitacora
// GET /api/bitacora?page=1&tipo=errores
router.get("/", authenticate, getBitacora);

export default router;