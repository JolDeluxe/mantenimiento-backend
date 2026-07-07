// src/modules/recurrencias/06_materialize.ts
// POST /api/recurrencias/:id/materialize
//
// ANTI-DUPLICIDAD: La validación es por (reglaRecurrenciaId + fechaCicloLogica).
//   - Si el ticket ya existe → respuesta 200 idempotente (no error, no duplicado).
//   - El unique constraint de BD es la última línea de defensa.
//   - Error P2002 (unique violation) se trata como caso esperado, no como crash.
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { normalizarFechaLogica } from "./helper";
import { materializarCicloInterno } from "./02_create";

export const materializeRegla = async (req: Request, res: Response) => {
  try {
    const id             = Number(req.params.id);
    const creadorId      = req.user!.id;
    const fechaBodyRaw   = req.body?.fechaCicloLogica;

    // --- 1. Obtener la regla con datos de máquina ---
    const regla = await prisma.reglaRecurrencia.findUnique({
      where: { id },
      include: {
        maquina: { select: { id: true, planta: true, area: true, estado: true } },
      },
    });
    if (!regla) return res.status(404).json({ error: "Regla no encontrada" });
    if (!regla.activo) return res.status(400).json({ error: "La regla está inactiva y no puede generar tickets" });

    if (regla.maquina.estado === "BAJA" || regla.maquina.estado === "BAJA_ERP") {
      return res.status(400).json({ error: "La máquina está dada de baja" });
    }

    // --- 2. Resolver la fecha lógica del ciclo ---
    // Si el cliente envía fechaCicloLogica, usarla; si no, usar proximaFechaEjecucion de la regla.
    const fechaCicloLogica = normalizarFechaLogica(
      fechaBodyRaw ? new Date(fechaBodyRaw) : regla.proximaFechaEjecucion
    );

    // --- 3. Verificar idempotencia ANTES de intentar crear (optimización) ---
    const ticketExistente = await prisma.tarea.findFirst({
      where: { reglaRecurrenciaId: id, fechaCicloLogica },
      select: { id: true, titulo: true, estado: true, fechaCicloLogica: true, reglaRecurrenciaId: true },
    });

    if (ticketExistente) {
      return res.status(200).json({
        ticket: ticketExistente,
        yaExistia: true,
        mensaje: "El ciclo ya tenía un ticket materializado. Se devuelve el existente.",
      });
    }

    // --- 4. Crear el ticket ---
    const ticket = await materializarCicloInterno({
      regla,
      fechaCicloLogica,
      maquinaPlanta: regla.maquina.planta,
      maquinaArea:   regla.maquina.area,
      creadorId,
    });

    // --- 5. Avanzar proximaFechaEjecucion de la regla al siguiente ciclo ---
    // Solo si estamos materializando el ciclo vigente (la proximaFechaEjecucion actual)
    // No avanzar si se está materializando un ciclo pasado u otro ciclo específico.
    const esCicloVigente =
      fechaCicloLogica.getTime() === normalizarFechaLogica(regla.proximaFechaEjecucion).getTime();

    if (esCicloVigente) {
      const { calcularSiguienteFechaLogica } = await import("./helper");
      const siguienteFecha = calcularSiguienteFechaLogica(
        fechaCicloLogica,
        regla.frecuencia,
        regla.intervaloDias,
      );
      await prisma.reglaRecurrencia.update({
        where: { id },
        data: { proximaFechaEjecucion: siguienteFecha },
      });
    }

    return res.status(201).json({
      ticket,
      yaExistia: false,
      mensaje: "Ticket de mantenimiento preventivo materializado correctamente",
    });
  } catch (error) {
    console.error("[recurrencias] materializeRegla error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
