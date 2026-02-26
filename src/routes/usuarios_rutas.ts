import { Router } from "express";
import { Rol } from "@prisma/client"; 
import { authenticate } from "../middlewares/authenticate"; 
import { authorize } from "../middlewares/authorize";    
import { upload } from "../middlewares/upload";   
import { validate } from "../middlewares/validate";

import { 
  listUsuariosSchema,
  getUsuarioByIdSchema,
  createUsuarioSchema,
  updateUsuarioSchema,
  patchUsuarioSchema 
} from "../modules/usuarios/zod";

import { listarUsuarios, listarInactivos, getUsuarioById } from "../modules/usuarios/01_list";
import { crearUsuario } from "../modules/usuarios/02_create";
import { updateUsuario } from "../modules/usuarios/03_update";
import { changeStatusUsuario } from "../modules/usuarios/04_patch";

const router = Router();

router.use(authenticate);

// --- RUTAS GET ---

// GET /api/usuarios
router.get("/", 
  validate(listUsuariosSchema), 
  listarUsuarios
);

// GET /api/usuarios/inactivos
router.get("/inactivos", 
  authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO]), 
  validate(listUsuariosSchema),
  listarInactivos
);

// GET /api/usuarios/:id
router.get("/:id", 
  validate(getUsuarioByIdSchema), 
  getUsuarioById
);

// --- RUTAS POST ---

// POST /api/usuarios
router.post(
  "/", 
  authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO]),
  upload.single('imagen'),
  validate(createUsuarioSchema), 
  crearUsuario
);

// --- RUTAS PUT ---

// PUT /api/usuarios/:id
router.put(
  "/:id", 
  upload.single('imagen'),
  validate(updateUsuarioSchema),
  updateUsuario
);

// --- RUTAS PATCH ---

// PATCH /api/usuarios/:id
router.patch(
  "/:id",
  authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO]),
  validate(patchUsuarioSchema), 
  changeStatusUsuario
);

export default router;