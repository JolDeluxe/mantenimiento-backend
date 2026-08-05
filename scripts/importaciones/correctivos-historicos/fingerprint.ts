import crypto from "crypto";
import type { RawHistoricalRow } from "./types";

export const IMPORT_SOURCE_VERSION = "HIST_CORR_2025_2026";

/**
 * Normaliza el código de máquina: trim, mayúsculas, ceros iniciales.
 * Ej: " mbc0005 " -> "MBC0005"
 */
export function normalizeMachineCode(code: string): string {
  if (!code) return "";
  let clean = code.trim().toUpperCase();
  // Si viene como MBC5 o mbc5, normalizar a MBC0005
  const match = clean.match(/^(MBC)(\d+)$/);
  if (match) {
    const num = match[2]!;
    clean = `MBC${num.padStart(4, "0")}`;
  }
  return clean;
}

/**
 * Genera el fingerprint SHA-256 determinista para un registro histórico.
 * No incluye el rowNumber para garantizar idempotencia entre ejecuciones.
 */
export function generateRowFingerprint(
  fechaStr: string,
  codigoMaquinaNorm: string,
  horaInicioStr: string,
  horaFinStr: string,
  duracionStr: string,
  departamentoStr: string,
  lineaStr: string
): string {
  const payload = [
    IMPORT_SOURCE_VERSION,
    fechaStr.trim(),
    codigoMaquinaNorm.trim(),
    horaInicioStr.trim(),
    horaFinStr.trim(),
    duracionStr.trim(),
    departamentoStr.trim().toUpperCase(),
    lineaStr.trim().toUpperCase(),
  ].join("|");

  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  return `${IMPORT_SOURCE_VERSION}:${hash}`;
}
