import type { Request, Response } from "express";
import { prisma } from "../../db";
import { isAdminOrJefe, isTecnico } from "./helper";
import { createTicketAdmin } from "./create/create_admin";
import { createTicketCliente } from "./create/create_cliente";
import { ClasificacionTarea } from "@prisma/client";

export const createTicket = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (isTecnico(user.rol)) {
      return res.status(403).json({ 
        error: "Acceso denegado." 
      });
    }

    const { maquinaId, categoria, clasificacion } = req.body;

    // 1. Lógica condicional para categoría MAQUINARIA
    if (categoria === "MAQUINARIA" && maquinaId) {
      const maquinaIdNum = Number(maquinaId);
      if (isNaN(maquinaIdNum)) {
        return res.status(400).json({ error: "El ID de la máquina debe ser un número válido." });
      }

      const maquinaDb = await prisma.maquina.findUnique({
        where: { id: maquinaIdNum },
        select: { planta: true, area: true, estado: true }
      });

      if (!maquinaDb) {
        return res.status(400).json({ error: "La máquina seleccionada no existe." });
      }

      // Validar estado operativo (no permitir bajas)
      if (maquinaDb.estado === "BAJA" || maquinaDb.estado === "BAJA_ERP") {
        return res.status(400).json({ error: "No se pueden crear tickets para una máquina dada de baja." });
      }

      // Inyectamos planta y área oficiales (Thin Client)
      req.body.planta = maquinaDb.planta;
      req.body.area = maquinaDb.area;
    } else if (categoria !== "MAQUINARIA") {
      // Si no es MAQUINARIA, forzar que no haya máquina vinculada para evitar inconsistencias
      req.body.maquinaId = null;
    }

    // 2. Clasificación por defecto: CORRECTIVO si viene vacía
    if (!clasificacion || clasificacion === "" || clasificacion === "null") {
      req.body.clasificacion = ClasificacionTarea.CORRECTIVO;
    }

    if (isAdminOrJefe(user.rol)) {
      return createTicketAdmin(req, res);
    } else { 
      return createTicketCliente(req, res);
    }

  } catch (error) {
    console.error("Error en dispatcher de creación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};