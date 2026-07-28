import { Router } from "express";
import { validate } from "../middlewares/validate";
import { gatewayQuerySchema } from "../modules/autonomos/public/zod";
import { getAutonomosGateway } from "../modules/autonomos/public/gateway";
import { getAutonomosFormulario } from "../modules/autonomos/public/formulario";

const router = Router();

// Endpoint público del gateway QR de mantenimiento autónomo
router.get("/autonomos/gateway", validate(gatewayQuerySchema), getAutonomosGateway);

// Endpoint público para obtener el formulario dinámico combinado
router.get("/autonomos/formulario", validate(gatewayQuerySchema), getAutonomosFormulario);

export default router;
