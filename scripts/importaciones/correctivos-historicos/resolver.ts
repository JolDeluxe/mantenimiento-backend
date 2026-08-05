import { prisma } from "../../../src/db";
import { Rol, Estatus } from "@prisma/client";
import type { ParsedHistoricalRecord, ResolvedHistoricalRecord } from "./types";

export interface ContextoResolucion {
  maquinasMap: Map<string, { id: number; codigo: string; nombre: string; planta: string | null; area: string | null; proceso: string; criticidad: string | null }>;
  clientesInternos: { id: number; username: string; departamentoId: number | null }[];
  clientesPorDeptoMap: Map<number, { id: number; username: string }[]>;
  existingFingerprints: Set<string>;
  tecnicoIdExplicit?: number;
  confirmadorIdExplicit?: number;
}

/**
 * Carga todos los catálogos y datos existentes en la base de datos en memoria
 * para resolver los registros por lotes sin incurrir en N+1.
 */
export async function cargarContextoResolucion(
  tecnicoIdExplicit?: number,
  confirmadorIdExplicit?: number
): Promise<ContextoResolucion> {
  // 1. Obtener todas las máquinas (incluidas inactivas)
  const maquinas = await prisma.maquina.findMany({
    select: {
      id: true,
      codigo: true,
      nombre: true,
      planta: true,
      area: true,
      proceso: true,
      criticidad: true,
    },
  });

  const maquinasMap = new Map<string, typeof maquinas[0]>();
  for (const m of maquinas) {
    maquinasMap.set(m.codigo.trim().toUpperCase(), m);
  }

  // 2. Obtener usuarios CLIENTE_INTERNO activos
  const clientes = await prisma.usuario.findMany({
    where: {
      rol: Rol.CLIENTE_INTERNO,
      estado: Estatus.ACTIVO,
    },
    select: {
      id: true,
      username: true,
      departamentoId: true,
    },
  });

  const clientesPorDeptoMap = new Map<number, { id: number; username: string }[]>();
  for (const c of clientes) {
    if (c.departamentoId !== null) {
      const list = clientesPorDeptoMap.get(c.departamentoId) || [];
      list.push({ id: c.id, username: c.username });
      clientesPorDeptoMap.set(c.departamentoId, list);
    }
  }

  // 3. Cargar fingerprints ya importados previamente
  // Buscamos tareas cuya descripción o incidenteId contenga la marca de importación
  const tareasImportadas = await prisma.tarea.findMany({
    where: {
      descripcion: {
        contains: "[IMPORT:HIST_CORR_2025_2026:",
      },
    },
    select: {
      descripcion: true,
    },
  });

  const existingFingerprints = new Set<string>();
  const regex = /\[IMPORT:(HIST_CORR_2025_2026:[a-f0-9]{64})\]/;
  for (const t of tareasImportadas) {
    const match = t.descripcion.match(regex);
    if (match && match[1]) {
      existingFingerprints.add(match[1]);
    }
  }

  return {
    maquinasMap,
    clientesInternos: clientes,
    clientesPorDeptoMap,
    existingFingerprints,
    tecnicoIdExplicit,
    confirmadorIdExplicit,
  };
}

/**
 * Selecciona determinísticamente un CLIENTE_INTERNO usando un hash del fingerprint.
 */
export function selectDeterministicClient(
  fingerprint: string,
  clientes: { id: number; username: string }[]
): { id: number; username: string } | null {
  if (clientes.length === 0) return null;

  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = (hash << 5) - hash + fingerprint.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  const index = Math.abs(hash) % clientes.length;
  return clientes[index] || null;
}

/**
 * Resuelve un registro individual contra el contexto de la base de datos.
 */
export function resolveHistoricalRecord(
  parsed: ParsedHistoricalRecord,
  ctx: ContextoResolucion,
  fingerprintsEnArchivo: Set<string>
): ResolvedHistoricalRecord {
  if (!parsed.isValid) {
    return {
      ...parsed,
      maquinaId: null,
      maquinaCodigo: null,
      maquinaNombre: null,
      clienteInternoId: null,
      clienteInternoUsername: null,
      tecnicoId: null,
      confirmadorId: null,
      isDuplicateInFile: false,
      isAlreadyInDb: false,
      isPotentialDuplicate: false,
      action: "OMITIR_INVALIDA",
    };
  }

  // 1. Resolver Máquina por código exacto
  const maquina = ctx.maquinasMap.get(parsed.codigoMaquinaNorm);
  if (!maquina) {
    return {
      ...parsed,
      maquinaId: null,
      maquinaCodigo: parsed.codigoMaquinaNorm,
      maquinaNombre: null,
      clienteInternoId: null,
      clienteInternoUsername: null,
      tecnicoId: null,
      confirmadorId: null,
      isDuplicateInFile: false,
      isAlreadyInDb: false,
      isPotentialDuplicate: false,
      isValid: false,
      errorCode: "MAQUINA_NO_EXISTENTE",
      errorDetail: `No se encontró máquina con el código exacto '${parsed.codigoMaquinaNorm}' en la base de datos.`,
      action: "OMITIR_MAQUINA_INEXISTENTE",
    };
  }

  // 2. Verificar duplicado en archivo
  if (fingerprintsEnArchivo.has(parsed.fingerprint)) {
    return {
      ...parsed,
      maquinaId: maquina.id,
      maquinaCodigo: maquina.codigo,
      maquinaNombre: maquina.nombre,
      clienteInternoId: null,
      clienteInternoUsername: null,
      tecnicoId: null,
      confirmadorId: null,
      isDuplicateInFile: true,
      isAlreadyInDb: false,
      isPotentialDuplicate: false,
      isValid: false,
      errorCode: "DUPLICADO_EN_ARCHIVO",
      errorDetail: "El registro es un duplicado exacto de otra fila en el mismo archivo.",
      action: "OMITIR_DUPLICADO_ARCHIVO",
    };
  }

  // 3. Verificar si ya fue importado en la base de datos (Idempotencia)
  if (ctx.existingFingerprints.has(parsed.fingerprint)) {
    return {
      ...parsed,
      maquinaId: maquina.id,
      maquinaCodigo: maquina.codigo,
      maquinaNombre: maquina.nombre,
      clienteInternoId: null,
      clienteInternoUsername: null,
      tecnicoId: null,
      confirmadorId: null,
      isDuplicateInFile: false,
      isAlreadyInDb: true,
      isPotentialDuplicate: false,
      isValid: false,
      errorCode: "YA_IMPORTADO_EN_BASE",
      errorDetail: "El registro ya existe importado previamente en la base de datos.",
      action: "OMITIR_YA_IMPORTADA",
    };
  }

  // 4. Seleccionar CLIENTE_INTERNO determinísticamente
  const cliente = selectDeterministicClient(parsed.fingerprint, ctx.clientesInternos);
  if (!cliente) {
    return {
      ...parsed,
      maquinaId: maquina.id,
      maquinaCodigo: maquina.codigo,
      maquinaNombre: maquina.nombre,
      clienteInternoId: null,
      clienteInternoUsername: null,
      tecnicoId: null,
      confirmadorId: null,
      isDuplicateInFile: false,
      isAlreadyInDb: false,
      isPotentialDuplicate: false,
      isValid: false,
      errorCode: "CLIENTE_INTERNO_NO_DISPONIBLE",
      errorDetail: "No se encontraron usuarios activos con rol CLIENTE_INTERNO en la base de datos.",
      action: "OMITIR_INVALIDA",
    };
  }

  // 5. Registrar en el Set de archivo para evitar duplicados futuros en esta corrida
  fingerprintsEnArchivo.add(parsed.fingerprint);

  return {
    ...parsed,
    maquinaId: maquina.id,
    maquinaCodigo: maquina.codigo,
    maquinaNombre: maquina.nombre,
    clienteInternoId: cliente.id,
    clienteInternoUsername: cliente.username,
    tecnicoId: ctx.tecnicoIdExplicit || null,
    confirmadorId: ctx.confirmadorIdExplicit || null,
    isDuplicateInFile: false,
    isAlreadyInDb: false,
    isPotentialDuplicate: false,
    action: "IMPORTAR",
  };
}
