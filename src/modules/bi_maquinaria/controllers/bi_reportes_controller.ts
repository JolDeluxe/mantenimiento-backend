import type { Request, Response } from "express";
import { z } from "zod";
import { registrarError } from "../../../utils/logger";
import { validarYCalcularPeriodo, ISO_WITH_OFFSET_REGEX } from "../calculations/periodos";
import { BIAggregationService, type AggregatedRow } from "../services/bi_aggregation_service";
import { BIMetricsService } from "../services/bi_metrics_service";
import { BIQueryService } from "../services/bi_query_service";

const BI_REPORT_TOP_LIMIT = 10;

const reportBoolean = z.union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((value) => value === true || value === "true");

const reportOptionalPositiveInt = z.union([z.number(), z.string()]).optional().transform((value, ctx) => {
  if (value === undefined || value === "") return undefined;

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "maquinaId debe ser un entero positivo." });
    return z.NEVER;
  }

  return numeric;
});

const reportIsoDate = (fieldName: "desde" | "hasta") => z.string().refine(
  (value) => ISO_WITH_OFFSET_REGEX.test(value),
  { message: `El campo '${fieldName}' debe tener zona horaria u offset explícito.` },
);

const reportSchema = z.object({
  body: z.object({
    formato: z.enum(["PDF", "EXCEL"]).default("PDF"),
    agrupacion: z.enum(["EQUIPO", "PROCESO", "AREA"]).default("EQUIPO"),
    periodoTipo: z.string().trim().optional(),
    desde: reportIsoDate("desde"),
    hasta: reportIsoDate("hasta"),
    maquinaId: reportOptionalPositiveInt,
    proceso: z.string().trim().optional(),
    area: z.string().trim().optional(),
    criticidad: z.string().trim().optional(),
    estadoMaquina: z.string().trim().optional(),
    buscar: z.string().trim().optional(),
    calidad: z.enum(["CONFIRMADOS", "CONFIRMADOS_E_INCOMPLETOS"]).default("CONFIRMADOS_E_INCOMPLETOS"),
    incluirHistoricos: reportBoolean,
    incluirAreaNula: reportBoolean,
    ordenarPor: z.enum([
      "DISPONIBILIDAD",
      "NOMBRE",
      "CODIGO",
      "TIEMPO_REPARACION",
      "RESTAURACION",
      "FRECUENCIA",
      "MTTR",
      "MTBF",
      "CONFIABILIDAD_1D",
      "CONFIABILIDAD_7D",
      "CONFIABILIDAD_30D",
      "CONFIABILIDAD_90D",
    ]).default("DISPONIBILIDAD"),
    direccion: z.enum(["ASC", "DESC"]).default("ASC"),
  }).strict().refine((data) => {
    try {
      return new Date(data.desde) < new Date(data.hasta);
    } catch {
      return false;
    }
  }, {
    message: "La fecha 'desde' debe ser estrictamente menor que la fecha 'hasta'.",
  }),
});

type ReportInput = z.infer<typeof reportSchema>["body"];

const formatNumber = (value: number | null | undefined, decimals = 0) => (
  value === null || value === undefined || Number.isNaN(value)
    ? ""
    : value.toLocaleString("es-MX", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
);

const formatPercent = (value: number | null | undefined) => (
  value === null || value === undefined ? "" : `${formatNumber(value, 2)}%`
);

const formatDate = (value: string | Date) => new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(value));

const safeText = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const getReportTitle = (agrupacion: ReportInput["agrupacion"]) => {
  if (agrupacion === "PROCESO") return "KPI Maquinaria por Familias";
  if (agrupacion === "AREA") return "KPI Maquinaria por Ubicaciones";
  return "KPI Maquinaria por Equipos";
};

const getRowName = (row: AggregatedRow) => {
  if (row.agrupacion === "PROCESO") return row.proceso || "Sin familia";
  if (row.agrupacion === "AREA") return row.area || "Sin ubicación";
  return `${row.equipo?.codigo || ""} ${row.equipo?.nombre || ""}`.trim();
};

const getRowsForExport = (rows: AggregatedRow[]) => rows.map((row) => ({
  ranking: row.ranking,
  nombre: getRowName(row),
  equipos: row.cantidadMaquinas,
  tiempoReparacion: Math.round(row.metricas.mttr.sumaMinutosTrabajoTecnico ?? 0),
  paroProduccion: Math.round(row.metricas.disponibilidad.minutosParoEquivalentes ?? 0),
  frecuencia: row.metricas.frecuencia.valor ?? 0,
  mttr: row.metricas.mttr.valorMinutos === null ? "" : Math.round(row.metricas.mttr.valorMinutos),
  mtbf: row.metricas.mtbf.valorDias === null ? "" : formatNumber(row.metricas.mtbf.valorDias, 2),
  disponibilidad: formatPercent(row.metricas.disponibilidad.valorPorcentaje),
  confiabilidadDia: formatPercent(row.metricas.confiabilidad.r1DiaPorcentaje),
  confiabilidadSemana: formatPercent(row.metricas.confiabilidad.r7DiasPorcentaje),
  confiabilidadMes: formatPercent(row.metricas.confiabilidad.r30DiasPorcentaje),
}));

const reportColumns = [
  ["ranking", "#"],
  ["nombre", "Equipo / Grupo"],
  ["equipos", "Equipos"],
  ["tiempoReparacion", "T. Reparación (min)"],
  ["paroProduccion", "Paro producción (min)"],
  ["frecuencia", "Frecuencia"],
  ["mttr", "MTTR (min)"],
  ["mtbf", "MTBF (días)"],
  ["disponibilidad", "Disponibilidad"],
  ["confiabilidadDia", "Conf. día"],
  ["confiabilidadSemana", "Conf. semana"],
  ["confiabilidadMes", "Conf. mes"],
] as const;

const buildExcelHtml = (input: ReportInput, rows: AggregatedRow[], generadoAt: Date) => {
  const data = getRowsForExport(rows);
  const title = getReportTitle(input.agrupacion);

  return Buffer.from(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, sans-serif; }
    h1 { font-size: 20px; }
    .meta { color: #475569; font-size: 12px; margin-bottom: 14px; }
    table { border-collapse: collapse; width: 100%; }
    th { background: #e2e8f0; font-weight: 700; }
    th, td { border: 1px solid #cbd5e1; padding: 6px; font-size: 11px; }
    td.numeric { text-align: right; }
  </style>
</head>
<body>
  <h1>${safeText(title)}</h1>
  <div class="meta">
    Periodo: ${safeText(formatDate(input.desde))} - ${safeText(formatDate(input.hasta))}
    &nbsp;|&nbsp; Generado: ${safeText(formatDate(generadoAt))}
  </div>
  <table>
    <thead>
      <tr>${reportColumns.map(([, label]) => `<th>${safeText(label)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${data.map((row) => `<tr>${
        reportColumns.map(([key]) => {
          const value = row[key];
          const numericClass = typeof value === "number" || key !== "nombre" ? " class=\"numeric\"" : "";
          return `<td${numericClass}>${safeText(value)}</td>`;
        }).join("")
      }</tr>`).join("")}
    </tbody>
  </table>
</body>
</html>`, "utf8");
};

const pdfEscape = (value: string) => value
  .replaceAll("\\", "\\\\")
  .replaceAll("(", "\\(")
  .replaceAll(")", "\\)");

const buildPdf = (input: ReportInput, rows: AggregatedRow[], generadoAt: Date) => {
  const title = getReportTitle(input.agrupacion);
  const data = getRowsForExport(rows);
  const lines = [
    title,
    `Periodo: ${formatDate(input.desde)} - ${formatDate(input.hasta)}`,
    `Generado: ${formatDate(generadoAt)}`,
    "",
    "# | Equipo / Grupo | T. Rep | Paro | Frec | MTTR | MTBF | Disp.",
    ...data.map((row) => [
      row.ranking,
      row.nombre.slice(0, 32),
      row.tiempoReparacion,
      row.paroProduccion,
      row.frecuencia,
      row.mttr,
      row.mtbf,
      row.disponibilidad,
    ].join(" | ")),
  ];

  const objects: string[] = [];
  const pages: number[] = [];
  const linesPerPage = 42;

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");

  for (let pageStart = 0; pageStart < lines.length; pageStart += linesPerPage) {
    const pageLines = lines.slice(pageStart, pageStart + linesPerPage);
    const content = [
      "BT",
      "/F1 8 Tf",
      "10 TL",
      "36 806 Td",
      ...pageLines.map((line, index) => `${index === 0 ? "" : "T* " }(${pdfEscape(line)}) Tj`),
      "ET",
    ].join("\n");
    const contentObjectNumber = objects.length + 2;
    const pageObjectNumber = objects.length + 1;
    pages.push(pageObjectNumber);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${objects.length + 3} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  }

  const fontObjectNumber = objects.length + 1;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects[1] = `<< /Type /Pages /Kids [${pages.map((page) => `${page} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  for (const pageNumber of pages) {
    const pageObject = objects[pageNumber - 1];
    if (pageObject) {
      objects[pageNumber - 1] = pageObject.replace(/\/F1 \d+ 0 R/, `/F1 ${fontObjectNumber} 0 R`);
    }
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
};

const buildFilename = (input: ReportInput) => {
  const agrupacion = input.agrupacion === "PROCESO" ? "familias" : input.agrupacion === "AREA" ? "ubicaciones" : "equipos";
  const desde = input.desde.slice(0, 10);
  const hasta = input.hasta.slice(0, 10);
  const extension = input.formato === "PDF" ? "pdf" : "xls";
  return `kpi_maquinaria_${agrupacion}_${desde}_a_${hasta}.${extension}`;
};

const obtenerDatosReporte = async (input: ReportInput, ahora: Date) => {
  const { desde, hasta, hastaEfectivo } = validarYCalcularPeriodo({
    desdeStr: input.desde,
    hastaStr: input.hasta,
    ahora,
  });
  const { maquinas } = await BIQueryService.obtenerMaquinas({
    agrupacion: input.agrupacion,
    maquinaId: input.maquinaId,
    proceso: input.proceso,
    area: input.area,
    criticidad: input.criticidad,
    estadoMaquina: input.estadoMaquina,
    buscar: input.buscar,
    incluirAreaNula: input.incluirAreaNula,
    hastaEfectivo,
  });
  const individualResults = await BIMetricsService.calcularMetricasMaquinas(
    maquinas,
    desde,
    hastaEfectivo,
    input.calidad,
    ahora,
    input.incluirHistoricos,
    hasta,
  );

  const rowsOrdenadas = BIAggregationService.agruparYAgregar(
    individualResults,
    input.agrupacion,
    input.ordenarPor,
    input.direccion,
  );

  return {
    rows: rowsOrdenadas.slice(0, BI_REPORT_TOP_LIMIT),
  };
};

export const generarBIMaquinariaReporteController = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Autenticación requerida." },
    });
  }

  const validation = reportSchema.safeParse({ body: req.body });
  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BI_REPORT_INVALID_PARAMS",
        message: "Los parámetros del reporte son inválidos.",
        details: validation.error.issues,
      },
    });
  }

  const input = validation.data.body;
  const ahora = new Date();

  try {
    const { rows } = await obtenerDatosReporte(input, ahora);
    const filename = buildFilename(input);
    const isPdf = input.formato === "PDF";
    const fileBuffer = isPdf
      ? buildPdf(input, rows, ahora)
      : buildExcelHtml(input, rows, ahora);

    res.setHeader("Content-Type", isPdf ? "application/pdf" : "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(fileBuffer);
  } catch (error) {
    await registrarError("GENERAR_BI_MAQUINARIA_REPORTE", user.id, error);
    const msg = error instanceof Error ? error.message : "Error al generar el reporte.";
    return res.status(400).json({
      success: false,
      error: {
        code: "BI_REPORT_GENERATION_ERROR",
        message: msg,
      },
    });
  }
};

export const enviarBIMaquinariaReporteController = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Autenticación requerida." },
    });
  }

  const validation = reportSchema.safeParse({ body: req.body });
  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BI_REPORT_INVALID_PARAMS",
        message: "Los parámetros del reporte son inválidos.",
        details: validation.error.issues,
      },
    });
  }

  try {
    await obtenerDatosReporte(validation.data.body, new Date());
    return res.status(501).json({
      success: false,
      error: {
        code: "BI_REPORT_EMAIL_NOT_CONFIGURED",
        message: "El envío por correo de reportes BI aún no está configurado.",
      },
    });
  } catch (error) {
    await registrarError("ENVIAR_BI_MAQUINARIA_REPORTE", user.id, error);
    const msg = error instanceof Error ? error.message : "Error al preparar el reporte.";
    return res.status(400).json({
      success: false,
      error: {
        code: "BI_REPORT_SEND_ERROR",
        message: msg,
      },
    });
  }
};
