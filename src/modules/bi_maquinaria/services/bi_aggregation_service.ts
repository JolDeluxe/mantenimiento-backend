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

    // Ordenamiento con nulls al final
    aggregatedRows.sort((a, b) => {
      const valA = getSortValue(a, ordenarPor);
      const valB = getSortValue(b, ordenarPor);

      if (valA === null && valB === null) return 0;
      if (valA === null) return 1; // null al final
      if (valB === null) return -1; // null al final

      if (typeof valA === "string" && typeof valB === "string") {
        return direccion === "ASC"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      // Comparación numérica
      return direccion === "ASC"
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number);
    });

    return aggregatedRows;
  }
}

function getSortValue(row: AggregatedRow, key: string): string | number | null {
  switch (key) {
    case "NOMBRE":
      if (row.agrupacion === "EQUIPO" && row.equipo) {
        return row.equipo.codigo + " - " + row.equipo.nombre;
      }
      if (row.agrupacion === "PROCESO") {
        return row.proceso;
      }
      return row.area;
    case "FRECUENCIA":
      return row.metricas.frecuencia.valor;
    case "RESTAURACION":
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
