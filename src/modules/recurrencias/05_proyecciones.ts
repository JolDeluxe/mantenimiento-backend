// src/modules/recurrencias/05_proyecciones.ts
// GET /api/recurrencias/proyecciones?year=2026
// GET /api/recurrencias/:id/proyeccion?year=2026
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { generarProyeccionesPorAno, ajustarPorFinDeSemana, formatearFechaUTC } from "./helper";
import type { ProyeccionCiclo } from "./types";
import { keyAjuste, obtenerAjustesActivosPorRegla, resolverOcurrenciaDesdeAjuste } from "./ajustes-helper";

/**
 * GET /api/recurrencias/proyecciones?year=2026
 * Retorna todas las proyecciones virtuales (ciclos sin ticket real aún) de TODAS
 * las reglas activas para el año especificado.
 */
export const getProyeccionesGlobal = async (req: Request, res: Response) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();

    const reglasActivas = await prisma.reglaRecurrencia.findMany({
      where: { activo: true },
      select: {
        id: true,
        maquinaId: true,
        titulo: true,
        categoria: true,
        prioridad: true,
        frecuencia: true,
        intervaloDias: true,
        proximaFechaEjecucion: true,
        maquina: { select: { codigo: true, nombre: true } },
        tecnicoResponsable: { select: { id: true, nombre: true } },
      },
    });

    // Obtener los tickets reales ya materializados para todas estas reglas en el año
    const reglaIds = reglasActivas.map((r) => r.id);
    const inicioAno = new Date(Date.UTC(year, 0, 1));
    const finAno    = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const ticketsReales = await prisma.tarea.findMany({
      where: {
        reglaRecurrenciaId: { in: reglaIds },
        fechaCicloLogica:   { gte: inicioAno, lte: finAno },
      },
      select: { reglaRecurrenciaId: true, fechaCicloLogica: true },
    });
    const ajustesPorCiclo = await obtenerAjustesActivosPorRegla(reglaIds, inicioAno, finAno);

    // Construir set de claves materializadas: "reglaId|fechaISO"
    const materializados = new Set(
      ticketsReales
        .filter((t) => t.reglaRecurrenciaId != null && t.fechaCicloLogica != null)
        .map((t) => `${t.reglaRecurrenciaId}|${t.fechaCicloLogica!.toISOString()}`)
    );

    const proyecciones: ProyeccionCiclo[] = [];

    for (const regla of reglasActivas) {
      const ciclos = generarProyeccionesPorAno(
        regla.proximaFechaEjecucion,
        regla.frecuencia,
        regla.intervaloDias,
        year,
      );

      for (const ciclo of ciclos) {
        const key = `${regla.id}|${ciclo.toISOString()}`;
        const ocurrencia = resolverOcurrenciaDesdeAjuste(ciclo, ajustesPorCiclo.get(keyAjuste(regla.id, ciclo)) ?? null);
        const fechaVencimientoSugerida = ocurrencia.movida ? ocurrencia.fechaProgramada : ajustarPorFinDeSemana(ciclo);
        proyecciones.push({
          reglaId:          regla.id,
          maquinaId:        regla.maquinaId,
          maquinaCodigo:    regla.maquina.codigo,
          maquinaNombre:    regla.maquina.nombre,
          tecnicoId:        regla.tecnicoResponsable.id,
          tecnicoNombre:    regla.tecnicoResponsable.nombre,
          titulo:           regla.titulo,
          categoria:        regla.categoria,
          prioridad:        regla.prioridad,
          frecuencia:       regla.frecuencia,
          fechaCicloLogica: ciclo,
          fechaCicloLogicaFormateada: formatearFechaUTC(ciclo),
          fechaOriginal: ocurrencia.fechaOriginal,
          fechaOriginalFormateada: formatearFechaUTC(ocurrencia.fechaOriginal),
          fechaProgramada: ocurrencia.fechaProgramada,
          fechaProgramadaFormateada: formatearFechaUTC(ocurrencia.fechaProgramada),
          fechaProgramadaPreventiva: ocurrencia.fechaProgramadaPreventiva,
          fechaProgramadaPreventivaFormateada: ocurrencia.fechaProgramadaPreventiva ? formatearFechaUTC(ocurrencia.fechaProgramadaPreventiva) : null,
          ajusteTipo: ocurrencia.estadoAjuste,
          ajusteMotivo: ocurrencia.motivo,
          omitida: ocurrencia.omitida,
          movida: ocurrencia.movida,
          movidaDesde: ocurrencia.movidaDesde,
          movidaA: ocurrencia.movidaA,
          fechaVencimientoSugerida: fechaVencimientoSugerida,
          fechaVencimientoSugeridaFormateada: formatearFechaUTC(fechaVencimientoSugerida),
          pendienteMaterializar: !ocurrencia.omitida && !materializados.has(key),
        });
      }
    }

    // Ordenar por fecha lógica
    proyecciones.sort((a, b) => a.fechaCicloLogica.getTime() - b.fechaCicloLogica.getTime());

    return res.json({
      year,
      total: proyecciones.length,
      pendientes: proyecciones.filter((p) => p.pendienteMaterializar).length,
      data: proyecciones,
    });
  } catch (error) {
    console.error("[recurrencias] getProyeccionesGlobal error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

/**
 * GET /api/recurrencias/:id/proyeccion?year=2026
 * Proyecciones de una sola regla para el año especificado.
 */
export const getProyeccionRegla = async (req: Request, res: Response) => {
  try {
    const id   = Number(req.params.id);
    const year = Number(req.query.year) || new Date().getFullYear();

    const regla = await prisma.reglaRecurrencia.findUnique({
      where: { id },
      select: {
        id: true,
        maquinaId: true,
        titulo: true,
        categoria: true,
        prioridad: true,
        frecuencia: true,
        intervaloDias: true,
        proximaFechaEjecucion: true,
        maquina: { select: { codigo: true, nombre: true } },
        tecnicoResponsable: { select: { id: true, nombre: true } },
      },
    });
    if (!regla) return res.status(404).json({ error: "Regla no encontrada" });

    const inicioAno = new Date(Date.UTC(year, 0, 1));
    const finAno    = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const ticketsReales = await prisma.tarea.findMany({
      where: {
        reglaRecurrenciaId: id,
        fechaCicloLogica:   { gte: inicioAno, lte: finAno },
      },
      select: { reglaRecurrenciaId: true, fechaCicloLogica: true, estado: true, id: true },
    });
    const ajustesPorCiclo = await obtenerAjustesActivosPorRegla([id], inicioAno, finAno);

    const materializados = new Map(
      ticketsReales
        .filter((t) => t.fechaCicloLogica != null)
        .map((t) => [`${t.reglaRecurrenciaId}|${t.fechaCicloLogica!.toISOString()}`, t])
    );

    const ciclos = generarProyeccionesPorAno(
      regla.proximaFechaEjecucion,
      regla.frecuencia,
      regla.intervaloDias,
      year,
    );

    const proyecciones = ciclos.map((ciclo) => {
      const key     = `${regla.id}|${ciclo.toISOString()}`;
      const ticket  = materializados.get(key);
      const ocurrencia = resolverOcurrenciaDesdeAjuste(ciclo, ajustesPorCiclo.get(keyAjuste(regla.id, ciclo)) ?? null);
      const fechaVencimientoSugerida = ocurrencia.movida ? ocurrencia.fechaProgramada : ajustarPorFinDeSemana(ciclo);
      return {
        reglaId:          regla.id,
        maquinaId:        regla.maquinaId,
        maquinaCodigo:    regla.maquina.codigo,
        maquinaNombre:    regla.maquina.nombre,
        tecnicoId:        regla.tecnicoResponsable.id,
        tecnicoNombre:    regla.tecnicoResponsable.nombre,
        titulo:           regla.titulo,
        categoria:        regla.categoria,
        prioridad:        regla.prioridad,
        frecuencia:       regla.frecuencia,
        fechaCicloLogica: ciclo,
        fechaCicloLogicaFormateada: formatearFechaUTC(ciclo),
        fechaOriginal: ocurrencia.fechaOriginal,
        fechaOriginalFormateada: formatearFechaUTC(ocurrencia.fechaOriginal),
        fechaProgramada: ocurrencia.fechaProgramada,
        fechaProgramadaFormateada: formatearFechaUTC(ocurrencia.fechaProgramada),
        fechaProgramadaPreventiva: ocurrencia.fechaProgramadaPreventiva,
        fechaProgramadaPreventivaFormateada: ocurrencia.fechaProgramadaPreventiva ? formatearFechaUTC(ocurrencia.fechaProgramadaPreventiva) : null,
        ajusteTipo: ocurrencia.estadoAjuste,
        ajusteMotivo: ocurrencia.motivo,
        omitida: ocurrencia.omitida,
        movida: ocurrencia.movida,
        movidaDesde: ocurrencia.movidaDesde,
        movidaA: ocurrencia.movidaA,
        fechaVencimientoSugerida: fechaVencimientoSugerida,
        fechaVencimientoSugeridaFormateada: formatearFechaUTC(fechaVencimientoSugerida),
        pendienteMaterializar: ticket == null && !ocurrencia.omitida,
        ticketId:    ticket?.id   ?? null,
        ticketEstado: ticket?.estado ?? null,
      };
    });

    return res.json({ year, reglaId: id, total: proyecciones.length, data: proyecciones });
  } catch (error) {
    console.error("[recurrencias] getProyeccionRegla error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
