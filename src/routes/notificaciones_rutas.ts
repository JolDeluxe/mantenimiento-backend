import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";

import { subscribe }                                          from "../modules/notificaciones/01_subscribe";
import { listarNotificaciones, obtenerConteoNoLeidas }        from "../modules/notificaciones/02_list";
import {
  marcarComoLeida,
  marcarTodasComoLeidas,
  marcarComoAccionada,
}                                                             from "../modules/notificaciones/03_mark_read";

import {
  subscriptionSchema,
  listNotificacionesSchema,
  markReadSchema,
  markActionedSchema,
} from "../modules/notificaciones/zod";

const router = Router();

router.post("/subscribe",  authenticate, validate(subscriptionSchema), subscribe);

router.get("/",            authenticate, validate(listNotificacionesSchema), listarNotificaciones);
router.get("/count",       authenticate, obtenerConteoNoLeidas);

router.patch("/read-all",  authenticate, marcarTodasComoLeidas);
router.patch("/:id/read",  authenticate, validate(markReadSchema),     marcarComoLeida);
router.patch("/:id/action",authenticate, validate(markActionedSchema), marcarComoAccionada);

export default router;