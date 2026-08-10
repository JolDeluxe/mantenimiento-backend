import fs from "fs";
import type { RawHistoricalRow } from "./types";

/**
 * Parsea el archivo TSV / CSV de correctivos históricos.
 * Soporta tanto separadores por tabulador (\t) como por comas (,).
 */
export function parseHistoricalFile(filePath: string): RawHistoricalRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo fuente no existe en la ruta: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, "utf8");

  // Eliminar UTF-8 BOM si existe
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const rawRows: RawHistoricalRow[] = [];

  // Detectar delimitador (tabulador o coma)
  const headerLine = lines[0]!;
  const isTab = headerLine.includes("\t");
  const delimiter = isTab ? "\t" : ",";

  // Procesar filas de datos a partir de la fila 1 (la fila 0 es el encabezado)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const cols = line.split(delimiter).map((c) => c.trim());

    if (cols.length === 0 || (cols.length === 1 && cols[0] === "")) {
      continue;
    }

    if (isTab || cols.length >= 13) {
      // Estructura de 13 columnas completa
      rawRows.push({
        columna1: cols[0] || "",
        departamento: cols[1] || "",
        linea: cols[2] || "",
        equipo: cols[3] || "",
        horaInicio: cols[4] || "",
        horaFin: cols[5] || "",
        tiempoFormato: cols[6] || "",
        semana: cols[7] || "",
        mes: cols[8] || "",
        trMin: cols[9] || "",
        trHora: cols[10] || "",
        tiempoReparacion: cols[11] || "",
        columna2: cols[12] || "",
        rowNumber: i + 1,
      });
    } else {
      // Estructura simplificada (5 columnas: createdAt, codigo, fechaInicio, finalizadoAt, duracionReal)
      rawRows.push({
        columna1: cols[0] || "", // Fecha DD/MM/YY
        departamento: "Historico",
        linea: "Correctivo Historico",
        equipo: cols[1] || "",   // Código de máquina (ej: MBC0314)
        horaInicio: cols[2] || "", // HH:mm
        horaFin: cols[3] || "",    // HH:mm
        tiempoFormato: "",
        semana: "",
        mes: "",
        trMin: "",
        trHora: "",
        tiempoReparacion: cols[4] || "", // Duración en minutos
        columna2: "",
        rowNumber: i + 1,
      });
    }
  }

  return rawRows;
}
