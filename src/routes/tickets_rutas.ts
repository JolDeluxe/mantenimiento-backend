import { Router } from "express";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize"; 
import { upload } from "../middlewares/upload"; 
import { validate } from "../middlewares/validate"; 
import { Rol } from "@prisma/client";
import { 
  ticketFilterSchema, 
  getTicketByIdSchema, 
  updateTicketSchema, 
  changeStatusSchema,
  createTicketBatchSchema,
  rescheduleTicketsSchema,
  approveTicketsBatchSchema
} from "../modules/tickets/zod"; 

import { listarTickets } from "../modules/tickets/01_list";
import { getTicket } from "../modules/tickets/02_get";
import { createTicket } from "../modules/tickets/03_create";
import { updateTicket } from "../modules/tickets/04_update";
import { changeTicketStatus } from "../modules/tickets/05_status"; 
import { obtenerMetricasTickets } from "../modules/tickets/06_metrics";
import { rescheduleTickets } from "../modules/tickets/06_reschedule";
import { createBatchTickets } from "../modules/tickets/create/create_batch";
import { approveTicketsBatch } from "../modules/tickets/07_approve_batch";

const router = Router();
router.use(authenticate);

// --- RUTAS GET ---

// GET /api/tickets
router.get("/", 
    validate(ticketFilterSchema), 
    listarTickets
);

// GET /api/tickets/metrics
router.get("/metrics", 
    validate(ticketFilterSchema), 
    obtenerMetricasTickets
);

// GET /api/tickets/:id
router.get("/:id", 
    validate(getTicketByIdSchema), 
    getTicket
);

// --- RUTAS POST ---

// POST /api/tickets
router.post(
    "/", 
    upload.array('imagenes', 5),
    createTicket 
);

// POST /api/tickets/batch
router.post(
    "/batch", 
    authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]),
    validate(createTicketBatchSchema), 
    createBatchTickets
);


// --- RUTAS PUT ---

// PUT /api/tickets/:id
router.put(
    "/:id", 
    authorize
    ([
        Rol.SUPER_ADMIN, 
        Rol.JEFE_MTTO, 
        Rol.COORDINADOR_MTTO, 
        Rol.CLIENTE_INTERNO
    ]), 
    upload.array('imagenes', 5), 
    validate(updateTicketSchema), 
    updateTicket
);


// --- RUTAS PATCH ---

// PATCH /api/tickets/:id/status
router.patch(
    "/:id/status", 
    upload.array('imagenes', 5),
    validate(changeStatusSchema), 
    changeTicketStatus
);

// PATCH /api/tickets/reschedule
router.patch(
    "/reschedule",
    authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]),
    validate(rescheduleTicketsSchema),
    rescheduleTickets
);

// PATCH /api/tickets/approve-batch
router.patch(
    "/approve-batch",
    authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]),
    validate(approveTicketsBatchSchema),
    approveTicketsBatch
);

export default router;