import { Router } from "express";
import { validate } from "../middlewares/validate";
import { gatewayQuerySchema } from "../modules/autonomos/public/zod";
import { getAutonomosGateway } from "../modules/autonomos/public/gateway";

const router = Router();

// Endpoint público del gateway QR de mantenimiento autónomo
router.get("/autonomos/gateway", validate(gatewayQuerySchema), getAutonomosGateway);

export default router;
