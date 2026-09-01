// src/modules/recurrencias/06_materialize.ts
// POST /api/recurrencias/:id/materialize
//
// ANTI-DUPLICIDAD: La validación es por (reglaRecurrenciaId + fechaCicloLogica).
//   - Si el ticket ya existe → respuesta 200 idempotente (no error, no duplicado).
//   - El unique constraint de BD es la última línea de defensa.
//   - Error P2002 (unique violation) se trata como caso esperado, no como crash.
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { calcularSiguienteFechaLogica, normalizarFechaLogica } from "./helper";
import { materializarCicloInterno } from "./02_create";
import { resolverOcurrenciaConAjuste } from "./ajustes-helper";
import {
  esCicloProgramadoRecurrencia,
  resolverPoliticaMaterializacionRecurrencia,
} from "./materialization-policy";

const ESTADOS_MAQUINA_NO_OPERATIVOS = new Set(["BAJA", "BAJA", "DESUSO", "INACTIVA"]);

export const materializeRegla = async (req: Request, res: Response) => {
  try {
    const id             = Number(req.params.id);
    const creadorId      = req.user!.id;
    const fechaBodyRaw   = req.body?.fechaCicloLogica;
    const confirmarFuturo = req.body?.confirmarFuturo === true;

    // --- 1. Obtener la regla con datos de máquina ---
    const regla = await prisma.reglaRecurrencia.findUnique({
      where: { id },
      include: {
        maquina: { select: { id: true, planta: true, area: true, estado: true } },
      },
    });
    if (!regla) return res.status(404).json({ error: "Regla no encontrada" });
    if (!regla.activo) return res.status(400).json({ error: "La regla está inactiva y no puede generar tickets" });

    if (ESTADOS_MAQUINA_NO_OPERATIVOS.has(regla.maquina.estado)) {
      return res.status(400).json({ error: "La máquina no está operativa" });
    }

    // --- 2. Resolver la fecha lógica del ciclo ---
    // Si se omite fechaCicloLogica, aplica la misma política anti-backlog del cron.
    const hoyLogico = normalizarFechaLogica(new Date());
    const fechaExplicita = Boolean(fechaBodyRaw);
    const decision = resolverPoliticaMaterializacionRecurrencia(regla, hoyLogico);
    const fechaCicloLogica = normalizarFechaLogica(
      fechaBodyRaw ? new Date(fechaBodyRaw) : decision.fechaCicloLogica ?? decision.proximaFechaEjecucion
    );

    if (!fechaExplicita && !decision.fechaCicloLogica) {
      if (decision.requiereActualizarCursor) {
        await prisma.reglaRecurrencia.update({
          where: { id },
          data: { proximaFechaEjecucion: decision.proximaFechaEjecucion },
        });
      }
      return res.status(200).json({
        ticket: null,
        yaExistia: false,
        mensaje: "No hay ciclo preventivo materializable hoy. La próxima fecha quedó alineada al siguiente ciclo válido.",
      });
    }

    if (fechaExplicita) {
      if (fechaCicloLogica < hoyLogico && decision.fechaCicloLogica?.getTime() !== fechaCicloLogica.getTime()) {
        return res.status(400).json({ error: "Solo se permite recuperar la última ocurrencia vencida pendiente; no ciclos históricos anteriores" });
      }
      if (!esCicloProgramadoRecurrencia(regla, fechaCicloLogica)) {
        return res.status(400).json({ error: "La fecha solicitada no pertenece al patrón de recurrencia" });
      }
    }

    const ocurrencia = await resolverOcurrenciaConAjuste(id, fechaCicloLogica);

    if (ocurrencia.omitida) {
      return res.status(400).json({
        error: "Esta ocurrencia está omitida para este periodo. Quita el ajuste antes de generar mantenimiento.",
      });
    }

    if (fechaCicloLogica > hoyLogico && !confirmarFuturo) {
      return res.status(400).json({
        error: "No se permite materializar ciclos futuros sin confirmación explícita",
        requiereConfirmacion: true,
      });
    }
    const fechaEfectiva = normalizarFechaLogica(ocurrencia.fechaProgramadaPreventiva ?? fechaCicloLogica);
    if (fechaEfectiva > hoyLogico && !confirmarFuturo) {
      return res.status(400).json({
        error: "La ocurrencia está movida a una fecha futura y requiere confirmación explícita",
        requiereConfirmacion: true,
      });
    }

    // --- 3. Verificar idempotencia ANTES de intentar crear (optimización) ---
    const ticketExistente = await prisma.tarea.findFirst({
      where: { reglaRecurrenciaId: id, fechaCicloLogica },
      select: { id: true, titulo: true, estado: true, fechaCicloLogica: true, reglaRecurrenciaId: true },
    });

    if (ticketExistente) {
      if (decision.fechaCicloLogica?.getTime() === fechaCicloLogica.getTime()) {
        await prisma.reglaRecurrencia.update({
          where: { id },
          data: { proximaFechaEjecucion: decision.proximaFechaEjecucion },
        });
      }
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
      fechaProgramadaPreventiva: ocurrencia.fechaProgramadaPreventiva,
      maquinaPlanta: regla.maquina.planta,
      maquinaArea:   regla.maquina.area,
      creadorId,
    });

    // --- 5. Avanzar proximaFechaEjecucion de la regla al siguiente ciclo ---
    // Solo si estamos materializando el ciclo vigente seguro.
    const esCicloVigente =
      decision.fechaCicloLogica?.getTime() === fechaCicloLogica.getTime() ||
      fechaCicloLogica.getTime() === normalizarFechaLogica(regla.proximaFechaEjecucion).getTime();

    if (esCicloVigente) {
      const siguienteFecha = decision.fechaCicloLogica?.getTime() === fechaCicloLogica.getTime()
        ? decision.proximaFechaEjecucion
        : calcularSiguienteFechaLogica(
          fechaCicloLogica,
          regla.frecuencia,
          regla.intervaloDias,
          regla.fechaInicio,
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
