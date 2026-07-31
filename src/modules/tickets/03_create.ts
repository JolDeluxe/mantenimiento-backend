import type { Request, Response } from "express";
import { prisma } from "../../db";
import { isAdminOrJefe, isTecnico } from "./helper";
import { createTicketAdmin } from "./create/create_admin";
import { createTicketCliente } from "./create/create_cliente";
import { createTicketClientRequestSchema } from "./zod";
import { getPlantasOperativas } from "../maquinas/helper";
import type { CreateTicketClientResolvedDTO } from "./types";
import type { Prioridad } from "@prisma/client";

export const createTicket = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (isTecnico(user.rol)) {
      return res.status(403).json({ 
        error: "Acceso denegado." 
      });
    }

    if (isAdminOrJefe(user.rol)) {
      return createTicketAdmin(req, res);
    }

    // ── CLIENTE_INTERNO PATH ──────────────────────────────────────────

    // 1. Validar estrictamente el request público con Zod
    const validation = createTicketClientRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Datos de formulario inválidos",
        details: validation.error.issues
      });
    }
    const input = validation.data;

    let finalPlanta: string | null = null;
    let finalArea: string | null = "";
    let finalTitulo = "";
    let finalMaquinaId: number | null = null;
    let finalParoProduccion = false;
    let finalFechaParo: Date | null = null;

    if (input.categoria === "MAQUINARIA") {
      if (!input.maquinaId) {
        return res.status(400).json({ error: "Debe vincular una máquina para reportes de Maquinaria." });
      }

      const maquinaDb = await prisma.maquina.findUnique({
        where: { id: input.maquinaId },
        select: { planta: true, area: true, estado: true, nombre: true, codigo: true }
      });

      if (!maquinaDb) {
        return res.status(400).json({ error: "La máquina seleccionada no existe." });
      }

      if (maquinaDb.estado === "BAJA" || maquinaDb.estado === "BAJA") {
        return res.status(400).json({ error: "No se pueden crear tickets para una máquina dada de baja." });
      }

      finalMaquinaId = input.maquinaId;
      finalPlanta = maquinaDb.planta;
      finalArea = maquinaDb.area;

      const tituloBase = input.titulo.trim();
      const tituloCompuesto = `${tituloBase} — ${maquinaDb.nombre} [${maquinaDb.codigo}]`;
      finalTitulo = tituloCompuesto.substring(0, 255);

      if (input.paroProduccion) {
        if (!input.fechaParoProduccion) {
          return res.status(400).json({ error: "Debe indicar la fecha y hora del paro de producción." });
        }
        const maxPermitido = new Date(Date.now() + 24 * 60 * 60 * 1000);
        if (input.fechaParoProduccion > maxPermitido) {
          return res.status(400).json({ error: "La fecha de paro de producción no puede ser en el futuro." });
        }
        finalParoProduccion = true;
        finalFechaParo = input.fechaParoProduccion;
      }
    } else {
      if (input.planta && input.planta.trim() !== "") {
        const plantasValidas = await getPlantasOperativas();
        const plantaInputUpper = input.planta.trim().toUpperCase();
        if (!plantasValidas.includes(plantaInputUpper)) {
          return res.status(400).json({ error: `La planta "${input.planta}" no es una opción válida.` });
        }
        finalPlanta = plantaInputUpper;
      }

      if (!input.area || input.area.trim() === "") {
        return res.status(400).json({ error: "Debe indicar el área o ubicación." });
      }
      finalArea = input.area.trim();
      finalTitulo = input.titulo.trim().substring(0, 255);
    }

    const resolvedDTO: CreateTicketClientResolvedDTO = {
      categoria: input.categoria.trim(),
      incidenteId: input.incidenteId.trim(),
      titulo: finalTitulo,
      prioridad: input.prioridad as Prioridad,
      descripcion: input.descripcion.trim(),
      planta: finalPlanta,
      area: finalArea ?? "",
      maquinaId: finalMaquinaId,
      paroProduccion: finalParoProduccion,
      fechaParoProduccion: finalFechaParo,
    };

    return createTicketCliente(req, res, resolvedDTO);

  } catch (error) {
    console.error("Error en dispatcher de creación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
