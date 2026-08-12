import { Router } from "express";
import { Rol } from "@prisma/client";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import {
  confirmarFallaController,
  descartarFallaController,
} from "../modules/bi_maquinaria/controllers/bi_controller";
import {
  getBIKPISController,
  getBIDetailController,
  getBIFiltrosController,
} from "../modules/bi_maquinaria/controllers/bi_metrics_controller";
import {
  enviarBIMaquinariaReporteController,
  generarBIMaquinariaReporteController,
} from "../modules/bi_maquinaria/controllers/bi_reportes_controller";

const router = Router();

// Todas las rutas requieren autenticación básica
router.use(authenticate);

// --- ENDPOINTS ANALÍTICOS DE BI (Roles: SUPER_ADMIN, JEFE_MTTO, COORDINADOR_MTTO) ---
const rolesBI = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];

// GET /api/bi/maquinaria/kpis - Listado agrupado y métricas principales
router.get("/kpis", authorize(rolesBI), getBIKPISController);

// GET /api/bi/maquinaria/filtros - Catálogos de filtros
router.get("/filtros", authorize(rolesBI), getBIFiltrosController);

// POST /api/bi/maquinaria/reportes/generar - Exportación descargable
router.post("/reportes/generar", authorize(rolesBI), generarBIMaquinariaReporteController);

// POST /api/bi/maquinaria/reportes/enviar - Reservado para envío por correo
router.post("/reportes/enviar", authorize(rolesBI), enviarBIMaquinariaReporteController);

// GET /api/bi/maquinaria/:maquinaId/detalle - Detalle analítico por máquina
router.get("/:maquinaId/detalle", authorize(rolesBI), getBIDetailController);

// --- ACCIONES TÉCNICAS (Fase 1) ---
// Confirmar falla: técnico confirma la avería y provee la fecha real.
router.post(
  "/fallas/:fallaId/confirmar",
  authorize([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO, Rol.SUPER_ADMIN]),
  confirmarFallaController,
);

// Descartar falla: técnico determina que no hubo avería real.
router.post(
  "/fallas/:fallaId/descartar",
  authorize([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO, Rol.SUPER_ADMIN]),
  descartarFallaController,
);

export default router;
