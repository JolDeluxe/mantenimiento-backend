import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { listBitacoraSchema } from "../modules/bitacora/zod";
import { getBitacora } from "../modules/bitacora/01_list";

const router = Router();

// GET /api/bitacora
// GET /api/bitacora?page=1&tipo=errores
router.get("/", 
    authenticate, 
    validate(listBitacoraSchema), 
    getBitacora);

export default router;