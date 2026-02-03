import type { Request, Response, NextFunction } from "express";
import { Rol } from "@prisma/client"; 

export const authorize = (allowedRoles: Rol[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    if (!allowedRoles.includes(req.user.rol)) {
      return res.status(403).json({ 
        error: "Acceso denegado: No tienes los permisos necesarios." 
      });
    }

    next();
  };
};

