import fs from "fs";
import readline from "readline";
import { styleText } from "util";
import { prisma } from "../db";
import { env } from "../env";
import { EstadoTarea, TipoEvento, Rol } from "@prisma/client";

type Logger = Pick<Console, "log" | "error" | "warn">;

export interface MaquinariaCsvIngestOptions {
  filePath?: string;
  apply?: boolean;
  previewLimit?: number;
  logger?: Logger;
}

export interface MaquinariaCsvIngestResult {
  filePath: string;
  applied: boolean;
  totalFilas: number;
  nuevas: number;
  actualizadas: number;
  bajas: number;
  ignoradas: number;
  preview: {
    nuevas: string[];
    actualizadas: string[];
    bajas: string[];
  };
}

interface ParsedMachineRow {
  codeUpper: string;
  nombre: string;
  proceso: string;
  ubicacionRaw: string;
}

const MIN_VALID_ROWS_TO_APPLY = 100;

function cleanCell(val: string | undefined | null): string {
  if (val === undefined || val === null) return "";
  return val.replace(/"/g, "").replace(/[\r\n]+/g, " ").trim();
}

async function detectDelimiter(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let firstLine = "";
  for await (const line of rl) {
    firstLine = line;
    break;
  }

  rl.close();
  stream.destroy();

  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;

  if (tabCount > commaCount && tabCount > semicolonCount) return "\t";
  if (semicolonCount > commaCount) return ";";
  return ",";
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function derivePlanta(ubicacionRaw: string, procesoRaw: string): string {
  const ubicacionUpper = ubicacionRaw.toUpperCase();
  const procesoUpper = procesoRaw.toUpperCase();

  if (ubicacionUpper.includes("OMEGA") || ubicacionUpper.includes("PT OMEGA")) return "OMEGA";
  if (ubicacionUpper.includes("SIGMA") || ubicacionUpper.includes("LASER") || procesoUpper.includes("LASER")) return "SIGMA";
  if (ubicacionUpper.includes("LAMBDA") || ubicacionUpper.includes("BILLETERAS")) return "LAMBDA";
  if (ubicacionUpper.includes("VENTA")) return "VENTA";
  if (ubicacionUpper.includes("BAJA")) return "BAJA";
  if (ubicacionUpper.includes("SERVICIOS") || ubicacionUpper.includes("GENERAL")) return "GENERAL";
  return "KAPPA";
}

export async function procesarBajaMaquina(dbMaquinaId: number) {
  const ahora = new Date();
  // Encontrar el primer admin activo para asignar auditoría
  const admin = await prisma.usuario.findFirst({
    where: { rol: Rol.SUPER_ADMIN, estado: "ACTIVO" },
    select: { id: true }
  });
  const adminId = admin?.id ?? 1;

  await prisma.$transaction(async (tx) => {
    // 1. Cambiar estado a BAJA
    await tx.maquina.update({
      where: { id: dbMaquinaId },
      data: { estado: "BAJA" }
    });

    // 2. Desactivar reglas recurrentes preventivas
    await tx.reglaRecurrencia.updateMany({
      where: { maquinaId: dbMaquinaId, activo: true },
      data: { activo: false }
    });

    // 3. Obtener y cancelar tareas abiertas
    const tareasAbiertas = await tx.tarea.findMany({
      where: {
        maquinaId: dbMaquinaId,
        estado: { in: [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA] }
      },
      select: { id: true, estado: true }
    });

    for (const tarea of tareasAbiertas) {
      // Cerrar intervalos abiertos si los hay
      const intervaloAbierto = await tx.intervaloTiempo.findFirst({
        where: { tareaId: tarea.id, fin: null },
        orderBy: { inicio: "desc" }
      });
      
      let duracionMinutos = 0;
      if (intervaloAbierto) {
        duracionMinutos = Math.floor((ahora.getTime() - intervaloAbierto.inicio.getTime()) / 60000);
        await tx.intervaloTiempo.update({
          where: { id: intervaloAbierto.id },
          data: { fin: ahora, duracion: duracionMinutos }
        });
      }

      // Cancelar tarea
      await tx.tarea.update({
        where: { id: tarea.id },
        data: {
          estado: EstadoTarea.CANCELADA,
          finalizadoAt: ahora,
          ...(duracionMinutos > 0 ? { duracionReal: { increment: duracionMinutos } } : {})
        }
      });

      // Registrar historial
      await tx.historialTarea.create({
        data: {
          tareaId: tarea.id,
          usuarioId: adminId,
          tipo: TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: tarea.estado,
          estadoNuevo: EstadoTarea.CANCELADA,
          nota: "Cancelada automáticamente por baja definitiva de la máquina"
        }
      });
    }
  });
}

function deriveDepartamento(
  planta: string,
  area: string,
  proceso: string,
  deptoMap: Map<string, number>,
): number | null {
  const mttoId = deptoMap.get("Mantenimiento") || null;
  const prodKappaId = deptoMap.get("Producción Kappa") || null;
  const prodOmegaId = deptoMap.get("Producción Omega") || null;

  if (planta === "OMEGA") return prodOmegaId;

  const areaUpper = area.toUpperCase();
  const processUpper = proceso.toUpperCase();

  if (
    areaUpper.includes("PESPUNTE") ||
    areaUpper.includes("ACABADO") ||
    areaUpper.includes("MONTADO") ||
    areaUpper.includes("CINTOS") ||
    areaUpper.includes("ADORNO") ||
    areaUpper.includes("AVIOS") ||
    areaUpper.includes("CORTE") ||
    processUpper.includes("PESPUNTE") ||
    processUpper.includes("ACABADO") ||
    processUpper.includes("MONTADO")
  ) {
    return prodKappaId;
  }

  return mttoId;
}

const pushPreview = (list: string[], value: string, limit: number) => {
  if (list.length < limit) list.push(value);
};

export async function procesarIngestaMaquinariaCsv(options: MaquinariaCsvIngestOptions = {}): Promise<MaquinariaCsvIngestResult> {
  const logger = options.logger || console;
  const filePath = options.filePath || env.MAQUINARIA_CSV_FILE_PATH;
  const apply = Boolean(options.apply);
  const previewLimit = options.previewLimit ?? 30;

  if (!filePath) {
    throw new Error("MAQUINARIA_CSV_FILE_PATH no está configurado.");
  }

  logger.log(styleText("blue", "\n=================================================="));
  logger.log(styleText("blue", " ETL: INGESTA DE MAQUINARIA DESDE CSV OFICIAL"));
  logger.log(styleText("blue", "=================================================="));
  logger.log(`Modo: ${apply ? styleText("red", "APLICAR CAMBIOS") : styleText("yellow", "PREVIEW SIN ESCRIBIR")}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`No se encontró el archivo CSV en: ${filePath}`);
  }

  logger.log(`Archivo origen: ${styleText("cyan", filePath)}`);
  const delimiter = await detectDelimiter(filePath);
  logger.log(`Delimitador detectado: [${styleText("yellow", delimiter === "\t" ? "\\t" : delimiter)}]`);

  const maquinasDb = await prisma.maquina.findMany({
    select: { id: true, codigo: true, estado: true },
  });

  const existingMap = new Map<string, { id: number; codigo: string; estado: string }>();
  for (const maquina of maquinasDb) {
    existingMap.set(maquina.codigo.toUpperCase().trim(), maquina);
  }

  logger.log(`Snapshot DB: ${styleText("green", `${existingMap.size} máquinas`)}`);

  const departamentos = await prisma.departamento.findMany({ select: { id: true, nombre: true } });
  const deptoMap = new Map<string, number>();
  for (const d of departamentos) deptoMap.set(d.nombre, d.id);

  let countNuevas = 0;
  let countActualizadas = 0;
  let countBajas = 0;
  let countIgnoradas = 0;
  let countTotalFilas = 0;
  const csvCodesSet = new Set<string>();
  const parsedRows: ParsedMachineRow[] = [];
  const preview = { nuevas: [] as string[], actualizadas: [] as string[], bajas: [] as string[] };

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isHeader = true;
  let buffer = "";

  for await (const line of rl) {
    countTotalFilas++;
    buffer = buffer ? `${buffer}\n${line}` : line;

    const quoteCount = (buffer.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) continue;

    const currentLine = buffer;
    buffer = "";

    if (isHeader) {
      isHeader = false;
      continue;
    }

    if (!currentLine.trim()) {
      countIgnoradas++;
      continue;
    }

    try {
      const row = parseCSVLine(currentLine, delimiter);
      if (row.length < 4) {
        countIgnoradas++;
        continue;
      }

      const rawCode = cleanCell(row[0]);
      const nombre = cleanCell(row[1]);
      const proceso = cleanCell(row[2]);
      const ubicacionRaw = cleanCell(row[3]);
      const codeUpper = rawCode.toUpperCase().trim();

      if (!/^MBC\d{4}$/.test(codeUpper) || !nombre) {
        countIgnoradas++;
        continue;
      }

      csvCodesSet.add(codeUpper);
      parsedRows.push({ codeUpper, nombre, proceso, ubicacionRaw });
    } catch (error) {
      logger.error(styleText("red", `Error al procesar línea ${countTotalFilas}:`), error);
      countIgnoradas++;
    }
  }

  rl.close();
  fileStream.destroy();

  if (apply && parsedRows.length < MIN_VALID_ROWS_TO_APPLY) {
    throw new Error(`CSV inseguro: solo ${parsedRows.length} máquinas válidas. Mínimo requerido para aplicar: ${MIN_VALID_ROWS_TO_APPLY}.`);
  }

  for (const parsedRow of parsedRows) {
    const { codeUpper, nombre, proceso, ubicacionRaw } = parsedRow;
    const area = ubicacionRaw.slice(0, 100);
    const planta = derivePlanta(ubicacionRaw, proceso).slice(0, 100);
    const departamentoId = deriveDepartamento(planta, area, proceso, deptoMap);
    const isBaja = ubicacionRaw.toUpperCase().includes("BAJA") || ubicacionRaw.toUpperCase().includes("VENTA");
    const estadoFinal = isBaja ? "BAJA" : "OPERATIVA";

    if (existingMap.has(codeUpper)) {
      const existing = existingMap.get(codeUpper)!;
      const nuevoEstado = isBaja ? "BAJA" : (existing.estado === "BAJA" ? "OPERATIVA" : undefined);

      if (apply) {
        if (nuevoEstado === "BAJA" && existing.estado !== "BAJA") {
          await procesarBajaMaquina(existing.id);
          await prisma.maquina.update({
            where: { id: existing.id },
            data: {
              nombre: nombre.slice(0, 255),
              proceso: proceso.slice(0, 150),
              planta,
              area,
              ubicacionDetalle: ubicacionRaw.slice(0, 255),
              departamentoId,
            },
          });
        } else {
          await prisma.maquina.update({
            where: { id: existing.id },
            data: {
              nombre: nombre.slice(0, 255),
              proceso: proceso.slice(0, 150),
              planta,
              area,
              ubicacionDetalle: ubicacionRaw.slice(0, 255),
              departamentoId,
              ...(nuevoEstado ? { estado: nuevoEstado } : {}),
            },
          });
        }
      } else {
        pushPreview(preview.actualizadas, `${codeUpper} — ${nombre}`, previewLimit);
      }
      countActualizadas++;
    } else {
      if (apply) {
        await prisma.maquina.create({
          data: {
            codigo: codeUpper,
            nombre: nombre.slice(0, 255),
            proceso: proceso.slice(0, 150),
            planta,
            area,
            ubicacionDetalle: ubicacionRaw.slice(0, 255),
            criticidad: "C",
            estado: estadoFinal,
            departamentoId,
          },
        });
      } else {
        pushPreview(preview.nuevas, `${codeUpper} — ${nombre}`, previewLimit);
      }
      countNuevas++;
    }

    const totalProcesadas = countNuevas + countActualizadas;
    if (totalProcesadas > 0 && totalProcesadas % 250 === 0) {
      logger.log(`Procesadas ${styleText("cyan", String(totalProcesadas))} máquinas...`);
    }
  }

  for (const [codeUpper, dbMaquina] of existingMap.entries()) {
    if (!csvCodesSet.has(codeUpper) && dbMaquina.estado !== "BAJA") {
      if (apply) {
        await procesarBajaMaquina(dbMaquina.id);
      } else {
        pushPreview(preview.bajas, codeUpper, previewLimit);
      }
      countBajas++;
    }
  }

  const result: MaquinariaCsvIngestResult = {
    filePath,
    applied: apply,
    totalFilas: countTotalFilas,
    nuevas: countNuevas,
    actualizadas: countActualizadas,
    bajas: countBajas,
    ignoradas: countIgnoradas,
    preview,
  };

  logger.log(styleText("blue", "\n=================================================="));
  logger.log(styleText("green", " PROCESO ETL COMPLETADO"));
  logger.log(styleText("blue", "=================================================="));
  logger.log(`Total líneas CSV: ${styleText("cyan", String(result.totalFilas))}`);
  logger.log(`Nuevas:           ${styleText("green", String(result.nuevas))}`);
  logger.log(`Actualizadas:     ${styleText("yellow", String(result.actualizadas))}`);
  logger.log(`BAJA:             ${styleText("red", String(result.bajas))}`);
  logger.log(`Ignoradas:        ${styleText("magenta", String(result.ignoradas))}`);

  if (!apply) {
    logger.log(styleText("yellow", "\nPREVIEW: no se escribió nada en base de datos."));
    logger.log(`Nuevas muestra:\n${preview.nuevas.length ? preview.nuevas.map((item) => `  - ${item}`).join("\n") : "  - Ninguna"}`);
    logger.log(`BAJA muestra:\n${preview.bajas.length ? preview.bajas.map((item) => `  - ${item}`).join("\n") : "  - Ninguna"}`);
  }

  logger.log(styleText("blue", "==================================================\n"));
  return result;
}
