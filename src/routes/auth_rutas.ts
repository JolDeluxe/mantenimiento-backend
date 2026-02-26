import { Router } from "express";
import { validate } from "../middlewares/validate";
import { authenticate } from "../middlewares/authenticate";

import { 
  loginSchema, 
  registerSchema, 
  forgotPasswordSchema, 
  resetPasswordSchema,
  changePasswordSchema, 
  refreshTokenSchema
} from "../modules/auth/zod";

import { login } from "../modules/auth/01_login";
import { register } from "../modules/auth/02_register";
import { getProfile } from "../modules/auth/03_profile";
import { changePassword } from "../modules/auth/04_change_password";
import { forgotPassword } from "../modules/auth/05_forgot_password";
import { resetPassword } from "../modules/auth/06_reset_password";
import { refreshSession } from "../modules/auth/07_refresh";
import { logout } from "../modules/auth/08_logout";

const router = Router();

// --- RUTAS PÚBLICAS ---

// POST /api/auth/login
router.post(
  "/login", 
  validate(loginSchema), 
  login
);

// POST /api/auth/register
router.post(
  "/register",
  validate(registerSchema),
  register
);

// POST /api/auth/forgot-password
router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  forgotPassword
);

// POST /api/auth/reset-password
router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  resetPassword
);

// POST /api/auth/refresh
router.post(
  "/refresh", 
  validate(refreshTokenSchema),
  refreshSession
);

// --- RUTAS PROTEGIDAS (Requieren Token) ---

// GET /api/auth/me 
router.get(
  "/me", 
  authenticate, 
  getProfile
);

// POST /api/auth/change-password
router.post(
  "/change-password", 
  authenticate, 
  validate(changePasswordSchema),
  changePassword
);

// POST /api/auth/logout
router.post(
  "/logout",
  authenticate, 
  validate(refreshTokenSchema),
  logout
);

export default router;