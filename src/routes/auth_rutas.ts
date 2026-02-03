import { Router } from "express";
import { validate } from "../middlewares/validate";
import { authenticate } from "../middlewares/authenticate";
import { loginSchema,registerSchema } from "../modules/auth/zod";
import { login } from "../modules/auth/01_login";
import { register } from "../modules/auth/02_register";
import { getProfile } from "../modules/auth/03_profile";
import { changePassword } from "../modules/auth/04_change_password";

const router = Router();

// --- RUTAS PÚBLICAS ---

// Login

// POST /api/auth/login
router.post(
  "/login", 
  validate(loginSchema), 
  login
);

//registro

// POST /api/auth/register
router.post(
  "/register",
  validate(registerSchema),
  register
);

// --- RUTAS PROTEGIDAS (Requieren Token) ---

// ver perfil 

// GET /api/auth/me 
router.get(
  "/me", 
  authenticate, 
  getProfile);

// cambiar contraseña

// POST /api/auth/change-password
router.post(
  "/change-password", 
  authenticate, 
  changePassword);

export default router;