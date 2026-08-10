import { DiasLaboradosQueryService } from "./dias_laborados_query_service";
import { calcularPeriodo, enumerarFechas } from "../calculations/periodos";
import { calcularTiempoReal } from "../calculations/intervalos";
import { calcularPlanTareas } from "../calculations/planificacion";
import { construirFilasDiarias, construirFilasMensuales, construirSummary } from "../calculations/agregacion";
import type {
  PeriodoDiasLaborados,
  FilaDiasLaborados,
  FilaMensualDiasLaborados,
  CalidadDatosDiasLaborados,
  SummaryDiasLaborados,
} from "../types";

export interface DiasLaboradosResponse {
  success: boolean;
  metadata: {
    periodo: PeriodoDiasLaborados;
    anio: number;
    semana: number | null;
    mes: number | null;
    desde: string;
    hasta: string;
    granularidad: "DIA" | "MES";
    generadoEn: string;
  };
  summary: SummaryDiasLaborados;
  data: FilaDiasLaborados[] | FilaMensualDiasLaborados[];
  calidadDatos: CalidadDatosDiasLaborados;
}

export class DiasLaboradosService {
  static async obtener(query: {
    periodo: PeriodoDiasLaborados;
    anio: number;
    semana?: number | null;
    mes?: number | null;
    ahora?: Date;
  }): Promise<DiasLaboradosResponse> {
    const ahora = query.ahora || new Date();
    
    // 1. Resolver el periodo de tiempo en local de México
    const periodoCalculado = calcularPeriodo(query);
    const { desde, hastaExclusivo, desdeFecha, hastaFecha, granularidad } = periodoCalculado;

    // 2. Ejecutar consultas concurrentes a la Base de Datos
    const [intervalos, tareas, preventivos] = await Promise.all([
      DiasLaboradosQueryService.obtenerIntervalos(desde, hastaExclusivo),
      DiasLaboradosQueryService.obtenerTareasPlanificadas(desde, hastaExclusivo),
      DiasLaboradosQueryService.obtenerFuentesRecurrentes(),
    ]);

    // 3. Procesar Tiempo Real y Calidad de Datos
    const resTiempoReal = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);

    // 4. Procesar Tiempo Programado
    const resPlan = calcularPlanTareas(tareas, desde, hastaExclusivo, preventivos);

    // 5. Enumerar todas las fechas del periodo y armar las filas diarias
    const fechasPeriodo = enumerarFechas(desdeFecha, hastaFecha);
    const filasDiarias = construirFilasDiarias(
      fechasPeriodo,
      resTiempoReal.tiempoRealPorDia,
      resPlan.planPorDia,
      ahora,
      new Set(resTiempoReal.fechasConIntervaloAbierto)
    );

    // 6. Construir filas de salida según la granularidad
    let data: FilaDiasLaborados[] | FilaMensualDiasLaborados[] = filasDiarias;
    if (granularidad === "MES") {
      data = construirFilasMensuales(filasDiarias, query.anio);
    }

    // 7. Calcular el Sumario Global
    const summary = construirSummary(filasDiarias);

    // Unir la calidad de los datos
    const calidadDatos: CalidadDatosDiasLaborados = {
      ...resTiempoReal.calidadDatos,
      tiempoProgramado: query.anio < 2026
        ? "HISTORICO_SIN_TIEMPO_PROGRAMADO"
        : resPlan.tareasSinTiempoProgramado > 0
          ? "PARCIAL"
          : "COMPLETO",
      tareasSinTiempoProgramado: resPlan.tareasSinTiempoProgramado,
    };

    return {
      success: true,
      metadata: {
        periodo: query.periodo,
        anio: query.anio,
        semana: query.semana || null,
        mes: query.mes || null,
        desde: desdeFecha,
        hasta: hastaFecha,
        granularidad,
        generadoEn: ahora.toISOString(),
      },
      summary,
      data,
      calidadDatos,
    };
  }
}
