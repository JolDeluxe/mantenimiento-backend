import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  EstadoTarea,
  Estatus,
  FrecuenciaRecurrencia,
  PrismaClient,
  Prioridad,
  Rol,
  TipoAjusteRecurrencia,
  UnidadRecurrenciaActividad,
} from "@prisma/client";

const TEST_DATABASE = "mantenimiento_actividades_recurrentes_test";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3017";
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "localhost", "La integración sólo admite host local");
assert.equal(url.pathname.slice(1), TEST_DATABASE, "La integración exige la base desechable autorizada");
const secret = process.env.JWT_SECRET;
assert.ok(secret, "JWT_SECRET es obligatorio");

const prisma = new PrismaClient();
const prefix = "AR-IT-";
const day = (offset = 0) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = new Date(Date.UTC(Number(parts.find((part) => part.type === "year")!.value), Number(parts.find((part) => part.type === "month")!.value) - 1, Number(parts.find((part) => part.type === "day")!.value) + offset));
  return value.toISOString().slice(0, 10);
};

type Http = { status: number; body: any };
const token = (id: number, rol: Rol) => jwt.sign({ id, rol }, secret!);
async function call(method: string, path: string, auth?: string, body?: unknown): Promise<Http> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const expectStatus = (response: Http, status: number) => assert.equal(response.status, status, JSON.stringify(response.body));

async function cleanup() {
  const rules = await prisma.reglaActividadRecurrente.findMany({ where: { titulo: { startsWith: prefix } }, select: { id: true } });
  const ruleIds = rules.map((rule) => rule.id);
  const tasks = ruleIds.length ? await prisma.tarea.findMany({ where: { reglaActividadRecurrenteId: { in: ruleIds } }, select: { id: true } }) : [];
  const taskIds = tasks.map((task) => task.id);
  if (taskIds.length) {
    await prisma.notificacion.deleteMany({ where: { tareaId: { in: taskIds } } });
    await prisma.historialTarea.deleteMany({ where: { tareaId: { in: taskIds } } });
    await prisma.tarea.deleteMany({ where: { id: { in: taskIds } } });
  }
  if (ruleIds.length) {
    await prisma.reglaActividadRecurrenteAjuste.deleteMany({ where: { reglaActividadRecurrenteId: { in: ruleIds } } });
    await prisma.reglaActividadRecurrente.deleteMany({ where: { id: { in: ruleIds } } });
  }
  const preventiveRules = await prisma.reglaRecurrencia.findMany({ where: { titulo: { startsWith: prefix } }, select: { id: true } });
  const preventiveIds = preventiveRules.map((rule) => rule.id);
  const preventiveTasks = preventiveIds.length ? await prisma.tarea.findMany({ where: { reglaRecurrenciaId: { in: preventiveIds } }, select: { id: true } }) : [];
  const preventiveTaskIds = preventiveTasks.map((task) => task.id);
  if (preventiveTaskIds.length) {
    await prisma.historialTarea.deleteMany({ where: { tareaId: { in: preventiveTaskIds } } });
    await prisma.tarea.deleteMany({ where: { id: { in: preventiveTaskIds } } });
  }
  if (preventiveIds.length) await prisma.reglaRecurrenciaAjuste.deleteMany({ where: { reglaRecurrenciaId: { in: preventiveIds } } });
  if (preventiveIds.length) await prisma.reglaRecurrencia.deleteMany({ where: { id: { in: preventiveIds } } });
  await prisma.maquina.deleteMany({ where: { codigo: { startsWith: prefix } } });
  const users = await prisma.usuario.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (userIds.length) {
    await prisma.historialTarea.deleteMany({ where: { usuarioId: { in: userIds } } });
    await prisma.intervaloTiempo.deleteMany({ where: { usuarioId: { in: userIds } } });
    await prisma.notificacionLog.deleteMany({ where: { usuarioId: { in: userIds } } });
    await prisma.bitacora.deleteMany({ where: { usuarioId: { in: userIds } } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: { in: userIds } } });
  }
  await prisma.usuario.deleteMany({ where: { username: { startsWith: prefix } } });
  await prisma.departamento.deleteMany({ where: { nombre: { startsWith: prefix } } });
}

async function main() {
  await cleanup();
  try {
    const department = await prisma.departamento.create({ data: { nombre: `${prefix}DEP`, planta: "TEST", tipo: "TEST" } });
    const users = await Promise.all([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO, Rol.TECNICO, Rol.CLIENTE_INTERNO].map((rol) =>
      prisma.usuario.create({ data: { username: `${prefix}${rol}`, email: `${rol.toLowerCase()}@ar-it.test`, password: "not-used", nombre: `${prefix}${rol}`, rol, estado: Estatus.ACTIVO, departamentoId: department.id } }),
    ));
    const byRole = new Map(users.map((user) => [user.rol, user]));
    const admin = byRole.get(Rol.SUPER_ADMIN)!;
    const tecnico = byRole.get(Rol.TECNICO)!;
    const adminToken = token(admin.id, admin.rol);

    expectStatus(await call("GET", "/api/actividades-recurrentes"), 401);
    expectStatus(await call("GET", "/api/actividades-recurrentes", token(tecnico.id, tecnico.rol)), 403);
    for (const role of [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]) {
      const user = byRole.get(role)!;
      expectStatus(await call("GET", "/api/actividades-recurrentes", token(user.id, user.rol)), 200);
    }

    const base = { titulo: `${prefix}con-responsable`, descripcion: "Prueba real", categoria: "GESTION", planta: null, area: "TEST", prioridad: Prioridad.ALTA, fechaInicio: day(), fechaFin: day(20), horaInicio: "08:00", horaFin: "09:30", tiempoEstimado: null, unidad: UnidadRecurrenciaActividad.DIA, intervalo: 1, responsables: [tecnico.id] };
    const create = await call("POST", "/api/actividades-recurrentes", adminToken, base);
    expectStatus(create, 201);
    const ruleId = create.body.data.id as number;
    const withoutPeople = await call("POST", "/api/actividades-recurrentes", adminToken, { ...base, titulo: `${prefix}sin-responsable`, horaInicio: null, horaFin: null, tiempoEstimado: 45, responsables: [] });
    expectStatus(withoutPeople, 201);
    const monthly = await call("POST", "/api/actividades-recurrentes", adminToken, { ...base, titulo: `${prefix}mensual`, unidad: UnidadRecurrenciaActividad.MES, intervalo: 1, responsables: [] });
    expectStatus(monthly, 201);

    expectStatus(await call("GET", `/api/actividades-recurrentes?area=TEST&page=1&limit=1`, adminToken), 200);
    expectStatus(await call("GET", `/api/actividades-recurrentes/${ruleId}`, adminToken), 200);
    const projections = await call("GET", `/api/actividades-recurrentes/proyecciones?from=${day()}&to=${day(4)}`, adminToken);
    expectStatus(projections, 200);
    assert.ok(projections.body.data.length > 0, "La ruta estática de proyecciones debe resolver antes de /:id");
    expectStatus(await call("PUT", `/api/actividades-recurrentes/${ruleId}`, adminToken, { titulo: `${prefix}actualizada` }), 200);
    for (const immutable of ["fechaInicio", "unidad", "intervalo", "proximaFechaEjecucion", "creadorId", "archivadoAt", "createdAt", "updatedAt"]) {
      expectStatus(await call("PUT", `/api/actividades-recurrentes/${ruleId}`, adminToken, { [immutable]: day() }), 400);
    }

    const materialized = await call("POST", `/api/actividades-recurrentes/${ruleId}/materialize`, adminToken, { fechaCicloLogica: day(), confirmarFuturo: true });
    expectStatus(materialized, 201);
    const taskId = materialized.body.data.id as number;
    const task = await prisma.tarea.findUniqueOrThrow({ where: { id: taskId }, include: { responsables: true, historial: true } });
    assert.equal(task.estado, EstadoTarea.ASIGNADA);
    assert.equal(task.tipo, "PLANEADA"); assert.equal(task.clasificacion, null); assert.equal(task.maquinaId, null); assert.equal(task.reglaRecurrenciaId, null);
    assert.equal(task.reglaActividadRecurrenteId, ruleId); assert.equal(task.responsables.length, 1); assert.equal(task.historial.length, 1);
    assert.ok(task.fechaVencimiento && task.horaInicioProgramada && task.horaFinProgramada && task.fechaCicloLogica && task.tiempoEstimado);
    expectStatus(await call("POST", `/api/actividades-recurrentes/${ruleId}/materialize`, adminToken, { fechaCicloLogica: day(), confirmarFuturo: true }), 200);
    assert.equal(await prisma.tarea.count({ where: { reglaActividadRecurrenteId: ruleId, fechaCicloLogica: task.fechaCicloLogica } }), 1);
    expectStatus(await call("DELETE", `/api/actividades-recurrentes/${ruleId}`, adminToken, { confirmar: true }), 409);

    const noPeopleId = withoutPeople.body.data.id as number;
    const noPeopleMaterialized = await call("POST", `/api/actividades-recurrentes/${noPeopleId}/materialize`, adminToken, { fechaCicloLogica: day(), confirmarFuturo: true });
    expectStatus(noPeopleMaterialized, 201);
    const noPeopleTask = await prisma.tarea.findUniqueOrThrow({ where: { id: noPeopleMaterialized.body.data.id }, include: { responsables: true } });
    assert.equal(noPeopleTask.estado, EstadoTarea.PENDIENTE); assert.equal(noPeopleTask.responsables.length, 0);

    const concurrent = await call("POST", "/api/actividades-recurrentes", adminToken, { ...base, titulo: `${prefix}concurrente`, responsables: [] });
    expectStatus(concurrent, 201);
    const concurrentId = concurrent.body.data.id as number;
    const concurrentResponses = await Promise.all([1, 2].map(() => call("POST", `/api/actividades-recurrentes/${concurrentId}/materialize`, adminToken, { fechaCicloLogica: day(), confirmarFuturo: true })));
    assert.deepEqual(concurrentResponses.map((response) => response.status).sort(), [200, 201]);
    assert.equal(await prisma.tarea.count({ where: { reglaActividadRecurrenteId: concurrentId } }), 1);
    assert.equal(await prisma.historialTarea.count({ where: { tarea: { reglaActividadRecurrenteId: concurrentId } } }), 1);

    const cursor = await call("POST", "/api/actividades-recurrentes", adminToken, { ...base, titulo: `${prefix}cursor`, fechaInicio: day(-2), fechaFin: day(10), responsables: [] });
    expectStatus(cursor, 201);
    const cursorId = cursor.body.data.id as number;
    expectStatus(await call("POST", `/api/actividades-recurrentes/${cursorId}/materialize`, adminToken, { fechaCicloLogica: day(-1), confirmarFuturo: true }), 201);
    expectStatus(await call("POST", `/api/actividades-recurrentes/${cursorId}/materialize`, adminToken, { fechaCicloLogica: day(1), confirmarFuturo: true }), 201);
    assert.equal((await prisma.reglaActividadRecurrente.findUniqueOrThrow({ where: { id: cursorId } })).proximaFechaEjecucion.toISOString().slice(0, 10), day(-2));
    expectStatus(await call("POST", `/api/actividades-recurrentes/${cursorId}/materialize`, adminToken, { fechaCicloLogica: day(-2), confirmarFuturo: true }), 201);
    assert.equal((await prisma.reglaActividadRecurrente.findUniqueOrThrow({ where: { id: cursorId } })).proximaFechaEjecucion.toISOString().slice(0, 10), day(-1));
    expectStatus(await call("POST", `/api/actividades-recurrentes/${cursorId}/materialize`, adminToken, { fechaCicloLogica: day(-2), confirmarFuturo: true }), 200);
    assert.equal((await prisma.reglaActividadRecurrente.findUniqueOrThrow({ where: { id: cursorId } })).proximaFechaEjecucion.toISOString().slice(0, 10), day(-1));

    const moveId = monthly.body.data.id as number;
    expectStatus(await call("POST", `/api/actividades-recurrentes/${moveId}/ocurrencias/mover`, adminToken, { fechaOriginal: day(), fechaNueva: day(1), motivo: "Prueba mover" }), 200);
    expectStatus(await call("POST", `/api/actividades-recurrentes/${moveId}/ocurrencias/mover`, adminToken, { fechaOriginal: day(), fechaNueva: day(1), motivo: "Reemplazo de ajuste" }), 200);
    const moved = await call("POST", `/api/actividades-recurrentes/${moveId}/materialize`, adminToken, { fechaCicloLogica: day(), confirmarFuturo: true });
    expectStatus(moved, 201);
    const movedTask = await prisma.tarea.findUniqueOrThrow({ where: { id: moved.body.data.id } });
    assert.equal(movedTask.fechaCicloLogica!.toISOString().slice(0, 10), day());
    assert.equal(movedTask.fechaVencimiento!.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }), day(1));
    expectStatus(await call("DELETE", `/api/actividades-recurrentes/${moveId}/ocurrencias/ajuste`, adminToken, { fechaOriginal: day() }), 200);

    const omitted = await call("POST", "/api/actividades-recurrentes", adminToken, { ...base, titulo: `${prefix}omitida`, responsables: [] });
    expectStatus(omitted, 201);
    const omittedId = omitted.body.data.id as number;
    expectStatus(await call("POST", `/api/actividades-recurrentes/${omittedId}/ocurrencias/omitir`, adminToken, { fechaOriginal: day(), motivo: "Paro controlado" }), 200);
    const skipped = await call("POST", `/api/actividades-recurrentes/${omittedId}/materialize`, adminToken, { fechaCicloLogica: day(), confirmarFuturo: true });
    expectStatus(skipped, 200); assert.equal(skipped.body.omitida, true);
    assert.equal(await prisma.tarea.count({ where: { reglaActividadRecurrenteId: omittedId } }), 0);
    const omittedRule = await prisma.reglaActividadRecurrente.findUniqueOrThrow({ where: { id: omittedId } });
    assert.equal(omittedRule.proximaFechaEjecucion.toISOString().slice(0, 10), day(1));
    expectStatus(await call("DELETE", `/api/actividades-recurrentes/${omittedId}`, adminToken, { confirmar: true }), 409);

    const disposable = await call("POST", "/api/actividades-recurrentes", adminToken, { ...base, titulo: `${prefix}eliminable`, responsables: [] });
    expectStatus(disposable, 201); expectStatus(await call("DELETE", `/api/actividades-recurrentes/${disposable.body.data.id}`, adminToken, { confirmar: true }), 204);
    expectStatus(await call("PATCH", `/api/actividades-recurrentes/${ruleId}/activo`, adminToken, { activo: false }), 200);
    expectStatus(await call("POST", `/api/actividades-recurrentes/${ruleId}/materialize`, adminToken, { fechaCicloLogica: day(1), confirmarFuturo: true }), 400);
    expectStatus(await call("PATCH", `/api/actividades-recurrentes/${ruleId}/activo`, adminToken, { activo: true }), 200);
    expectStatus(await call("PATCH", `/api/actividades-recurrentes/${ruleId}/archivar`, adminToken, {}), 200);
    expectStatus(await call("PATCH", `/api/actividades-recurrentes/${ruleId}/restaurar`, adminToken, {}), 200);

    const tickets = await call("GET", "/api/tickets?scope=actividades&page=1&limit=100", adminToken); expectStatus(tickets, 200);
    assert.ok(tickets.body.data.some((ticket: any) => ticket.id === taskId));
    const todayTickets = await call("GET", "/api/tickets?scope=actividades&perteneceAHoy=true&page=1&limit=100", adminToken); expectStatus(todayTickets, 200);
    assert.ok(todayTickets.body.data.some((ticket: any) => ticket.id === taskId));
    const ticketDetail = await call("GET", `/api/tickets/${taskId}`, adminToken); expectStatus(ticketDetail, 200);
    assert.equal(ticketDetail.body.reglaActividadRecurrenteId, ruleId);

    const machine = await prisma.maquina.create({ data: { codigo: `${prefix}M-1`, nombre: `${prefix}Máquina`, proceso: "TEST", area: "TEST", planta: "TEST", estado: "OPERATIVA" } });
    const preventive = await call("POST", "/api/recurrencias", adminToken, { maquinaId: machine.id, titulo: `${prefix}preventiva`, categoria: "MAQUINARIA", prioridad: Prioridad.MEDIA, tiempoEstimado: 30, frecuencia: FrecuenciaRecurrencia.SEMANAL, intervaloDias: null, tecnicoResponsableId: tecnico.id, proximaFechaEjecucion: day(), activo: true });
    expectStatus(preventive, 201);
    const preventiveId = preventive.body.regla.id as number;
    expectStatus(await call("GET", `/api/recurrencias/${preventiveId}/proyeccion?year=${new Date().getUTCFullYear()}`, adminToken), 200);
    expectStatus(await call("GET", `/api/recurrencias/matriz?year=${new Date().getUTCFullYear()}`, adminToken), 200);
    const preventiveTaskCount = await prisma.tarea.count({ where: { reglaRecurrenciaId: preventiveId } });
    assert.equal(preventiveTaskCount, 1, "La creación preventiva conserva su materialización vigente existente");
    await prisma.reglaRecurrenciaAjuste.upsert({ where: { reglaRecurrenciaId_fechaOriginal: { reglaRecurrenciaId: preventiveId, fechaOriginal: new Date(`${day()}T00:00:00.000Z`) } }, update: { tipo: TipoAjusteRecurrencia.MOVER, fechaNueva: new Date(`${day(1)}T00:00:00.000Z`), motivo: "Control" }, create: { reglaRecurrenciaId: preventiveId, fechaOriginal: new Date(`${day()}T00:00:00.000Z`), periodoAnio: new Date().getUTCFullYear(), periodoMes: new Date().getUTCMonth() + 1, tipo: TipoAjusteRecurrencia.MOVER, fechaNueva: new Date(`${day(1)}T00:00:00.000Z`), motivo: "Control", createdById: admin.id } });
    assert.equal(await prisma.tarea.count({ where: { reglaRecurrenciaId: preventiveId } }), 1, "El unique preventivo permanece independiente");

    console.log("INTEGRATION_PASS: actividades recurrentes, tickets y regresión preventiva");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

await main();
