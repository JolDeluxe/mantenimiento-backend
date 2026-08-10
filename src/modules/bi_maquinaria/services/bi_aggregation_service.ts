import type { MaquinaCalculatedResult } from "./bi_metrics_service";
import type { GroupMetricsResult } from "../calculations/aggregation";
import { agregarMetricasGrupo } from "../calculations/aggregation";

export interface AggregatedRow {
  key: string;
  agrupacion: "EQUIPO" | "PROCESO" | "AREA";
  equipo: {
    id: number;
    codigo: string;
    nombre: string;
    proceso: string;
    area: string | null;
    criticidad: string | null;
    estadoActual: string;
  } | null;
  proceso: string | null;
  area: string | null;
  cantidadMaquinas: number;
  metricas: GroupMetricsResult;
  /** Posición global (1-based) calculada sobre la población completa antes de paginar. */
  ranking: number;
  calidadDatos: {
    confirmados: number;
    incompletos: number;
    provisionalesExcluidos: number;
    historicosExcluidos: number;
    invalidos: number;
    estadoGeneral: string;
    advertencias: string[];
  };
}

export class BIAggregationService {
  /**
   * Agrupa y agrega los resultados individuales de las máquinas según la dimensión solicitada,
   * aplicando ordenamiento, paginación y reglas de nulos al final.
   */
  static agruparYAgregar(
    individualResults: MaquinaCalculatedResult[],
    agrupacion: "EQUIPO" | "PROCESO" | "AREA",
    ordenarPor: string,
    direccion: "ASC" | "DESC"
  ): AggregatedRow[] {
    const rowsMap = new Map<string, MaquinaCalculatedResult[]>();

    for (const r of individualResults) {
      let key = "";
      if (agrupacion === "EQUIPO") {
        key = `equipo_${r.maquina.id}`;
      } else if (agrupacion === "PROCESO") {
        key = r.maquina.proceso;
      } else if (agrupacion === "AREA") {
        // Si area es null, su key es null_area
        key = r.maquina.area !== null ? r.maquina.area : "null_area";
      }

      const list = rowsMap.get(key) || [];
      list.push(r);
      rowsMap.set(key, list);
    }

    const aggregatedRows: AggregatedRow[] = [];

    for (const [key, maquinasGrupo] of rowsMap.entries()) {
      const firstRow = maquinasGrupo[0];
      if (!firstRow) {
        continue;
      }

      const first = firstRow.maquina;
      const aggregatedMetrics = agregarMetricasGrupo(maquinasGrupo);

      // Consolidar calidad de datos del grupo
      let confirmados = 0;
      let incompletos = 0;
      let provisionalesExcluidos = 0;
      let historicosExcluidos = 0;
      let invalidos = 0;
      const advs = new Set<string>();

      for (const m of maquinasGrupo) {
        confirmados += m.calidadDatos.confirmados;
        incompletos += m.calidadDatos.incompletos;
        provisionalesExcluidos += m.calidadDatos.provisionalesExcluidos;
        historicosExcluidos += m.calidadDatos.historicosExcluidos;
        invalidos += m.calidadDatos.invalidos;
        m.calidadDatos.advertencias.forEach((a) => advs.add(a));
      }

      let estadoGeneral = "SIN_DATOS";
      if (confirmados > 0 && incompletos === 0) {
        estadoGeneral = "CONFIRMADO";
      } else if (incompletos > 0) {
        estadoGeneral = "DATO_INCOMPLETO";
      } else if (provisionalesExcluidos > 0) {
        estadoGeneral = "PROVISIONAL";
      }

      const row: AggregatedRow = {
        key,
        agrupacion,
        equipo: agrupacion === "EQUIPO" ? {
          id: first.id,
          codigo: first.codigo,
          nombre: first.nombre,
          proceso: first.proceso,
          area: first.area,
          criticidad: first.criticidad,
          estadoActual: first.estado,
        } : null,
        proceso: agrupacion === "PROCESO" ? key : null,
        area: agrupacion === "AREA" ? (key === "null_area" ? null : key) : null,
        cantidadMaquinas: maquinasGrupo.length,
        metricas: aggregatedMetrics,
        ranking: 0, // se asigna después del ordenamiento
        calidadDatos: {
          confirmados,
          incompletos,
          provisionalesExcluidos,
          historicosExcluidos,
          invalidos,
          estadoGeneral,
          advertencias: Array.from(advs),
        },
      };

      aggregatedRows.push(row);
    }

    // ─── Ordenamiento con nulls al final ───────────────────────────────────
    aggregatedRows.sort((a, b) => {
      const valA = getSortValue(a, ordenarPor);
      const valB = getSortValue(b, ordenarPor);

      // nulls siempre al final
      if (valA === null && valB === null) {
        return tiebreaker(a, b);
      }
      if (valA === null) return 1;
      if (valB === null) return -1;

      if (typeof valA === "string" && typeof valB === "string") {
        const cmp = valA.localeCompare(valB);
        return direccion === "ASC" ? cmp : -cmp;
      }

      // Comparación numérica
      const numCmp = (valA as number) - (valB as number);
      const directedCmp = direccion === "ASC" ? numCmp : -numCmp;

      // Desempate cuando los valores principales son iguales
      if (directedCmp === 0) {
        return tiebreaker(a, b);
      }
      return directedCmp;
    });

    // ─── Asignar ranking global (1-based, antes de paginar) ───────────────
    aggregatedRows.forEach((row, i) => {
      row.ranking = i + 1;
    });

    return aggregatedRows;
  }
}

/**
 * Desempate secundario cuando el criterio principal produce empate.
 *
 * Orden:
 *   1. minutosParoEquivalentes DESC
 *   2. frecuencia DESC
 *   3. MTTR DESC
 *   4. tiempoReparacion (sumaMinutosTrabajoTecnico) DESC
 *   5. código ASC
 */
function tiebreaker(a: AggregatedRow, b: AggregatedRow): number {
  // 1. minutosParoEquivalentes DESC
  const paroA = a.metricas.disponibilidad.minutosParoEquivalentes;
  const paroB = b.metricas.disponibilidad.minutosParoEquivalentes;
  if (paroB !== paroA) return paroB - paroA;

  // 2. frecuencia DESC
  const freqA = a.metricas.frecuencia.valor;
  const freqB = b.metricas.frecuencia.valor;
  if (freqB !== freqA) return freqB - freqA;

  // 3. MTTR DESC
  const mttrA = a.metricas.mttr.valorMinutos ?? 0;
  const mttrB = b.metricas.mttr.valorMinutos ?? 0;
  if (mttrB !== mttrA) return mttrB - mttrA;

  // 4. tiempoReparacion DESC
  const trA = a.metricas.mttr.sumaMinutosTrabajoTecnico;
  const trB = b.metricas.mttr.sumaMinutosTrabajoTecnico;
  if (trB !== trA) return trB - trA;

  // 5. código ASC
  const codigoA = getIdentifierLabel(a);
  const codigoB = getIdentifierLabel(b);
  return codigoA.localeCompare(codigoB);
}

function getIdentifierLabel(row: AggregatedRow): string {
  if (row.agrupacion === "EQUIPO" && row.equipo) {
    return row.equipo.codigo;
  }
  if (row.agrupacion === "PROCESO") return row.proceso ?? "";
  return row.area ?? "";
}

function getSortValue(row: AggregatedRow, key: string): string | number | null {
  switch (key) {
    case "NOMBRE":
    case "CODIGO":
      return getIdentifierLabel(row);
    case "FRECUENCIA":
      return row.metricas.frecuencia.valor;
    case "RESTAURACION":
    case "TIEMPO_REPARACION":
      return row.metricas.mttr.sumaMinutosTrabajoTecnico;
    case "MTTR":
      return row.metricas.mttr.valorMinutos;
    case "MTBF":
      return row.metricas.mtbf.valorDias;
    case "DISPONIBILIDAD":
      return row.metricas.disponibilidad.valorPorcentaje;
    case "CONFIABILIDAD_1D":
      return row.metricas.confiabilidad.r1DiaPorcentaje;
    case "CONFIABILIDAD_7D":
      return row.metricas.confiabilidad.r7DiasPorcentaje;
    case "CONFIABILIDAD_30D":
      return row.metricas.confiabilidad.r30DiasPorcentaje;
    case "CONFIABILIDAD_90D":
      return row.metricas.confiabilidad.r90DiasPorcentaje;
    default:
      return null;
  }
}
