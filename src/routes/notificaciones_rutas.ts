import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { subscribe } from "../modules/notificaciones/01_subscribe";
import { subscriptionSchema } from "../modules/notificaciones/zod";

const router = Router();

// POST /api/notificaciones/subscribe
// Seguridad: Requiere Token (authenticate) y valida estructura (Zod)
router.post(
  "/subscribe", 
  authenticate, 
  validate(subscriptionSchema), 
  subscribe
);

export default router;