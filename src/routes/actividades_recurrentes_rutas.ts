import { Rol } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validate } from "../middlewares/validate";
import { listarReglasActividad, obtenerReglaActividad } from "../modules/actividades_recurrentes/01_list";
import { crearReglaActividad } from "../modules/actividades_recurrentes/02_create";
import { actualizarReglaActividad } from "../modules/actividades_recurrentes/03_update";
import { archivarReglaActividad, cambiarActivoReglaActividad, eliminarReglaActividad, restaurarReglaActividad } from "../modules/actividades_recurrentes/04_lifecycle";
import { obtenerProyeccionesActividad, obtenerProyeccionesReglaActividad } from "../modules/actividades_recurrentes/05_proyecciones";
import { materializarReglaActividad } from "../modules/actividades_recurrentes/06_materialize";
import { listarAjustesActividad, moverOcurrenciaActividad, omitirOcurrenciaActividad, quitarAjusteActividad } from "../modules/actividades_recurrentes/07_ajustes";
import {
  cambiarActivoSchema,
  confirmacionVaciaSchema,
  createReglaActividadSchema,
  eliminarReglaActividadSchema,
  listReglasActividadSchema,
  materializarActividadSchema,
  moverOcurrenciaActividadSchema,
  omitirOcurrenciaActividadSchema,
  proyeccionesActividadSchema,
  proyeccionReglaActividadSchema,
  quitarAjusteActividadSchema,
  reglaIdSchema,
  updateReglaActividadSchema,
} from "../modules/actividades_recurrentes/zod";

const router = Router();
const rolesGestion = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];

router.use(authenticate);
router.use(authorize(rolesGestion));

router.get("/", validate(listReglasActividadSchema), listarReglasActividad);
router.get("/proyecciones", validate(proyeccionesActividadSchema), obtenerProyeccionesActividad);
router.get("/:id/proyecciones", validate(proyeccionReglaActividadSchema), obtenerProyeccionesReglaActividad);
router.get("/:id/ajustes", validate(reglaIdSchema), listarAjustesActividad);
router.get("/:id", validate(reglaIdSchema), obtenerReglaActividad);
router.post("/", validate(createReglaActividadSchema), crearReglaActividad);
router.put("/:id", validate(updateReglaActividadSchema), actualizarReglaActividad);
router.patch("/:id/activo", validate(cambiarActivoSchema), cambiarActivoReglaActividad);
router.patch("/:id/archivar", validate(confirmacionVaciaSchema), archivarReglaActividad);
router.patch("/:id/restaurar", validate(confirmacionVaciaSchema), restaurarReglaActividad);
router.delete("/:id", validate(eliminarReglaActividadSchema), eliminarReglaActividad);
router.post("/:id/materialize", validate(materializarActividadSchema), materializarReglaActividad);
router.post("/:id/ocurrencias/mover", validate(moverOcurrenciaActividadSchema), moverOcurrenciaActividad);
router.post("/:id/ocurrencias/omitir", validate(omitirOcurrenciaActividadSchema), omitirOcurrenciaActividad);
router.delete("/:id/ocurrencias/ajuste", validate(quitarAjusteActividadSchema), quitarAjusteActividad);

export default router;
