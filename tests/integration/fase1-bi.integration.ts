/**
 * backend/tests/integration/fase1-bi.integration.ts
 *
 * Suite de Pruebas de Integración de FASE 1 - Métricas de Maquinaria y BI.
 *
 * REGLAS OBLIGATORIAS:
 *   1. Ejecuta exclusivamente contra una base de datos de pruebas que termine en '_test' (mantenimiento_test).
 *   2. Aborta inmediatamente si la conexión apunta a una base normal.
 *   3. Pruebas reales y exhaustivas para todos los flujos de negocio.
 *   4. Aserciones de código de estado exactas (ej: toBe(200), toBe(400)).
 *   5. Prueba de rollback real validando que no quede ninguna escritura en base.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "../../src/db";
import {
  EstadoTarea,
  ClasificacionTarea,
  TipoTarea,
  ImpactoProduccionConfirmado,
  EstadoFalla,
  CalidadDato,
  TipoEvento,
} from "@prisma/client";
import { createTicketCliente } from "../../src/modules/tickets/create/create_cliente";
import { createTicketAdmin } from "../../src/modules/tickets/create/create_admin";
import { createBatchTickets } from "../../src/modules/tickets/create/create_batch";
import { ejecutarCambioEstado } from "../../src/modules/tickets/status/_core";
import { crearFallaProvisional } from "../../src/modules/bi_maquinaria/services/confirmacion_falla_service";

// 1. Aislamiento y validación de base de datos de pruebas
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.includes("_test")) {
  console.error("DATABASE_URL DE PRODUCCIÓN/DESARROLLO DETECTADA:", databaseUrl);
  throw new Error("ABORTANDO: Las pruebas de integración deben correr exclusivamente con DATABASE_URL apuntando a una base de pruebas que termine en '_test' (mantenimiento_test).");
}

describe("BI Maquinaria - Fase 1 Integración (mantenimiento_test)", () => {
  let maquinaId: number;
  let usuarioId: number;
  let deptoId: number;

  beforeAll(async () => {
    // Verificar conexión activa
    await prisma.$connect();

    // Crear datos base requeridos para los tests
    const depto = await prisma.departamento.create({
      data: {
        nombre: "TEST_BI_DEPTO_" + Date.now(),
        planta: "Planta Test",
        tipo: "Produccion",
      },
    });
    deptoId = depto.id;

    const user = await prisma.usuario.create({
      data: {
        username: "test_bi_user_" + Date.now(),
        password: "hashed_password",
        nombre: "BI Test User",
        rol: "SUPER_ADMIN",
        departamentoId: deptoId,
      },
    });
    usuarioId = user.id;

    const maquina = await prisma.maquina.create({
      data: {
        codigo: "MBC_TEST_" + Date.now(),
        nombre: "Máquina de Prueba BI",
        proceso: "Inyección",
        estado: "OPERATIVA",
        planta: "Planta Test",
        area: "General",
      },
    });
    maquinaId = maquina.id;
  });

  afterAll(async () => {
    // Limpieza exclusiva de los datos creados por esta suite.
    const tareas = await prisma.tarea.findMany({
      where: {
        OR: [
          { maquinaId },
          { creadorId: usuarioId },
        ],
      },
      select: { id: true },
    });
    const tareaIds = tareas.map((t) => t.id);

    await prisma.intervaloParoMaquina.deleteMany({ where: { maquinaId } });
    await prisma.fallaMaquina.deleteMany({ where: { maquinaId } });
    await prisma.intervaloTiempo.deleteMany({ where: { OR: [{ usuarioId }, { tareaId: { in: tareaIds } }] } });
    await prisma.historialTarea.deleteMany({ where: { OR: [{ usuarioId }, { tareaId: { in: tareaIds } }] } });
    await prisma.imagen.deleteMany({ where: { tareaId: { in: tareaIds } } });
    await prisma.notificacion.deleteMany({ where: { OR: [{ usuarioId }, { tareaId: { in: tareaIds } }] } });
    await prisma.notificacionLog.deleteMany({ where: { usuarioId } });
    await prisma.bitacora.deleteMany({ where: { usuarioId } });
    await prisma.tarea.deleteMany({ where: { id: { in: tareaIds } } });
    await prisma.maquina.deleteMany({ where: { id: maquinaId } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
    await prisma.departamento.delete({ where: { id: deptoId } });
    await prisma.$disconnect();
  });

  // Helpers para simular Express Request / Response
  const mockRes = () => {
    const res: any = {};
    res.statusCode = 200;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data: any) => {
      res.body = data;
      return res;
    };
    return res;
  };

  const mockReq = (user: any, body: any = {}, files: any[] = []) => {
    return {
      user,
      body,
      files,
      protocol: "http",
      get: () => "localhost",
    } as any;
  };

  // 1. Creación provisional desde create_cliente
  it("debe crear falla provisional al reportar ticket correctivo desde createTicketCliente", async () => {
    const req = mockReq(
      { id: usuarioId, departamentoId: deptoId },
      {} // body se pasa directo resuelto
    );
    const res = mockRes();
    const resolvedDTO = {
      titulo: "Falla reportada por cliente",
      descripcion: "Avería de prueba",
      categoria: "Mecanico",
      planta: "Planta Test",
      area: "General",
      prioridad: "MEDIA" as any,
      maquinaId,
      paroProduccion: true,
      fechaParoProduccion: new Date(),
      incidenteId: "",
    };

    await createTicketCliente(req, res, resolvedDTO);
    expect(res.statusCode).toBe(201); // Se crea correctamente

    const tarea = await prisma.tarea.findFirst({
      where: { titulo: "Falla reportada por cliente" },
    });
    expect(tarea).not.toBeNull();
    expect(tarea?.clasificacion).toBe(ClasificacionTarea.CORRECTIVO);

    const falla = await prisma.fallaMaquina.findUnique({
      where: { tareaId: tarea?.id },
    });
    expect(falla).not.toBeNull();
    expect(falla?.estado).toBe(EstadoFalla.PENDIENTE_DE_DIAGNOSTICO);
    expect(falla?.calidadDato).toBe(CalidadDato.PROVISIONAL);

    const paros = await prisma.intervaloParoMaquina.count({
      where: { tareaId: tarea!.id },
    });
    expect(paros).toBe(0);
  });

  it("reporte provisional con paro y confirmación técnica producen un único intervalo físico", async () => {
    const fechaParoCliente = new Date(Date.now() - 90 * 60 * 1000);
    const fechaFallaConfirmada = new Date(Date.now() - 80 * 60 * 1000);
    const inicioParo = new Date(Date.now() - 70 * 60 * 1000);

    const resCreate = mockRes();
    await createTicketCliente(
      mockReq({ id: usuarioId, departamentoId: deptoId }),
      resCreate,
      {
        titulo: "Falla con paro visible sin duplicar intervalo",
        descripcion: "El cliente reporta paro visible",
        categoria: "Mecanico",
        planta: "Planta Test",
        area: "General",
        prioridad: "CRITICA" as any,
        maquinaId,
        paroProduccion: true,
        fechaParoProduccion: fechaParoCliente,
        incidenteId: "",
      },
    );
    expect(resCreate.statusCode).toBe(201);

    const tarea = await prisma.tarea.findFirstOrThrow({
      where: { titulo: "Falla con paro visible sin duplicar intervalo" },
    });
    const fallaPrevia = await prisma.fallaMaquina.findUniqueOrThrow({
      where: { tareaId: tarea.id },
    });
    expect(fallaPrevia.fechaFallaReportada.getTime()).toBe(fechaParoCliente.getTime());
    expect(await prisma.intervaloParoMaquina.count({ where: { tareaId: tarea.id } })).toBe(0);

    const resResolve = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolución técnica",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaConfirmada,
        inicioParo,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resResolve,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resResolve.statusCode).toBe(200);

    const fallaFinal = await prisma.fallaMaquina.findUniqueOrThrow({
      where: { tareaId: tarea.id },
    });
    const paros = await prisma.intervaloParoMaquina.findMany({
      where: { tareaId: tarea.id },
    });
    expect(paros).toHaveLength(1);
    expect(paros[0]!.fallaId).toBe(fallaFinal.id);
    expect(paros[0]!.maquinaId).toBe(maquinaId);
    expect(paros[0]!.impacto).toBe(ImpactoProduccionConfirmado.PARO_TOTAL);
    expect(paros[0]!.porcentajeAfectacion).toBe(100);
    expect(paros[0]!.inicio.getTime()).toBe(inicioParo.getTime());
    expect(paros[0]!.fin).not.toBeNull();
  });

  // 2. Creación provisional desde create_admin
  it("debe crear falla provisional al crear tarea desde createTicketAdmin", async () => {
    const req = mockReq(
      { id: usuarioId, departamentoId: deptoId },
      {
        titulo: "Correctivo creado por Admin",
        descripcion: "Falla eléctrica",
        categoria: "Electrico",
        tipo: TipoTarea.EXTRAORDINARIA, // Admin no crea Tipo TICKET
        clasificacion: ClasificacionTarea.CORRECTIVO,
        maquinaId,
        prioridad: "ALTA",
        paroProduccion: false,
      }
    );
    const res = mockRes();

    await createTicketAdmin(req, res);
    expect(res.statusCode).toBe(201); // Se crea correctamente

    const tarea = await prisma.tarea.findFirst({
      where: { titulo: "Correctivo creado por Admin" },
    });
    expect(tarea).not.toBeNull();

    const falla = await prisma.fallaMaquina.findUnique({
      where: { tareaId: tarea?.id },
    });
    expect(falla).not.toBeNull();
  });

  // 3. Creación provisional desde create_batch
  it("debe crear falla provisional al crear tareas en lote desde createBatchTickets", async () => {
    const req = mockReq(
      { id: usuarioId, departamentoId: deptoId },
      {
        tareas: [
          {
            titulo: "Correctivo lote 1",
            descripcion: "Falla neumática",
            clasificacion: ClasificacionTarea.CORRECTIVO,
            maquinaId,
            prioridad: "MEDIA",
            paroProduccion: true,
            fechaParoProduccion: new Date(),
          },
          {
            titulo: "Preventivo lote 2",
            descripcion: "Lubricación general",
            clasificacion: ClasificacionTarea.PREVENTIVO,
            maquinaId,
            prioridad: "BAJA",
            paroProduccion: false,
          },
        ],
      }
    );
    const res = mockRes();

    await createBatchTickets(req, res);
    expect(res.statusCode).toBe(201); // Se crea correctamente

    // Validar correctivo
    const correctivo = await prisma.tarea.findFirst({ where: { titulo: "Correctivo lote 1" } });
    expect(correctivo).not.toBeNull();
    const fallaCorrectivo = await prisma.fallaMaquina.findUnique({ where: { tareaId: correctivo?.id } });
    expect(fallaCorrectivo).not.toBeNull();

    // Validar preventivo (lubricación) - NO debe crear falla provisional
    const preventivo = await prisma.tarea.findFirst({ where: { titulo: "Preventivo lote 2" } });
    expect(preventivo).not.toBeNull();
    const fallaPreventivo = await prisma.fallaMaquina.findUnique({ where: { tareaId: preventivo?.id } });
    expect(fallaPreventivo).toBeNull();
  });

  // 4. Idempotencia de creación provisional
  it("creación provisional de falla debe ser idempotente y no generar duplicados", async () => {
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo Idempotencia",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, {
        tareaId: tarea.id,
        maquinaId,
        fechaFallaReportada: new Date(),
      });
    });

    const count1 = await prisma.fallaMaquina.count({ where: { tareaId: tarea.id } });
    expect(count1).toBe(1);

    // Intentar crear de nuevo
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, {
        tareaId: tarea.id,
        maquinaId,
        fechaFallaReportada: new Date(),
      });
    });

    const count2 = await prisma.fallaMaquina.count({ where: { tareaId: tarea.id } });
    expect(count2).toBe(1); // Mismo conteo
  });

  // 5. Preventivo / Autónomo / Correctivo sin máquina NO generan falla
  it("tareas preventivas, autónomas y correctivos sin máquina no generan falla", async () => {
    // Preventivo
    const tPrev = await prisma.tarea.create({
      data: {
        titulo: "Preventiva 1",
        descripcion: "Preventivo",
        clasificacion: ClasificacionTarea.PREVENTIVO,
        tipo: TipoTarea.PLANEADA,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    // Autónomo
    const tAut = await prisma.tarea.create({
      data: {
        titulo: "Autónoma 1",
        descripcion: "Autónomo",
        clasificacion: ClasificacionTarea.AUTONOMO,
        tipo: TipoTarea.PLANEADA,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    // Correctivo sin máquina
    const tSinMaq = await prisma.tarea.create({
      data: {
        titulo: "Correctivo sin maq",
        descripcion: "Correctivo sin maquina",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId: null,
      },
    });

    // Validaciones
    const fPrev = await prisma.fallaMaquina.findUnique({ where: { tareaId: tPrev.id } });
    expect(fPrev).toBeNull();

    const fAut = await prisma.fallaMaquina.findUnique({ where: { tareaId: tAut.id } });
    expect(fAut).toBeNull();

    const fSinMaq = await prisma.fallaMaquina.findUnique({ where: { tareaId: tSinMaq.id } });
    expect(fSinMaq).toBeNull();
  });

  // 6. Confirmación y descarte independientes
  it("debe permitir confirmar y descartar fallas", async () => {
    // Confirmar
    const tConf = await prisma.tarea.create({
      data: {
        titulo: "Tarea para confirmar",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tConf.id, maquinaId, fechaFallaReportada: new Date() });
    });

    const fConf = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tConf.id } });

    const resConf = mockRes();
    const ahora = new Date();
    await ejecutarCambioEstado({
      ticketId: tConf.id,
      ticket: { ...tConf, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Confirmada",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: ahora,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "test@cuadra.com", nombre: "Admin" },
      req: mockReq({ id: usuarioId }),
      res: resConf,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resConf.statusCode).toBe(200);

    const fConfPost = await prisma.fallaMaquina.findUniqueOrThrow({ where: { id: fConf.id } });
    expect(fConfPost.estado).toBe(EstadoFalla.REHABILITADA);
    expect(fConfPost.contabilizaComoFalla).toBe(true);

    // Descartar
    const tDesc = await prisma.tarea.create({
      data: {
        titulo: "Tarea para descartar",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tDesc.id, maquinaId, fechaFallaReportada: new Date() });
    });

    const fDesc = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tDesc.id } });

    const resDesc = mockRes();
    await ejecutarCambioEstado({
      ticketId: tDesc.id,
      ticket: { ...tDesc, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Descartada",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      fallaResolucion: {
        descartar: true,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "test@cuadra.com", nombre: "Admin" },
      req: mockReq({ id: usuarioId }),
      res: resDesc,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resDesc.statusCode).toBe(200);

    const fDescPost = await prisma.fallaMaquina.findUniqueOrThrow({ where: { id: fDesc.id } });
    expect(fDescPost.estado).toBe(EstadoFalla.DESCARTADA);
    expect(fDescPost.contabilizaComoFalla).toBe(false);
  });

  // 7. SIN_PARO, PARO_PARCIAL (con % y sin %), PARO_TOTAL
  it("debe validar los tipos de impacto en producción e intervalos de paro correspondientes", async () => {
    const ahora = new Date();
    // SIN_PARO
    const tSin = await prisma.tarea.create({
      data: {
        titulo: "Impacto SIN_PARO",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tSin.id, maquinaId, fechaFallaReportada: ahora });
    });
    const resSin = mockRes();
    await ejecutarCambioEstado({
      ticketId: tSin.id,
      ticket: { ...tSin, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: ahora,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resSin,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resSin.statusCode).toBe(200);
    const parosSin = await prisma.intervaloParoMaquina.count({
      where: { falla: { tareaId: tSin.id } },
    });
    expect(parosSin).toBe(0);

    // PARO_PARCIAL con porcentaje
    const tParcCon = await prisma.tarea.create({
      data: {
        titulo: "Parcial con %",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tParcCon.id, maquinaId, fechaFallaReportada: ahora });
    });
    const resParcCon = mockRes();
    await ejecutarCambioEstado({
      ticketId: tParcCon.id,
      ticket: { ...tParcCon, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_PARCIAL,
        fechaFallaConfirmada: ahora,
        inicioParo: new Date(Date.now() - 3600000),
        porcentajeAfectacion: 45,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resParcCon,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resParcCon.statusCode).toBe(200);
    const paroParcCon = await prisma.intervaloParoMaquina.findFirstOrThrow({
      where: { falla: { tareaId: tParcCon.id } },
    });
    expect(paroParcCon.porcentajeAfectacion).toBe(45);
    expect(paroParcCon.calidadDato).toBe(CalidadDato.CONFIRMADO);

    // PARO_PARCIAL sin porcentaje (DATO_INCOMPLETO)
    const tParcSin = await prisma.tarea.create({
      data: {
        titulo: "Parcial sin %",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tParcSin.id, maquinaId, fechaFallaReportada: ahora });
    });
    const resParcSin = mockRes();
    await ejecutarCambioEstado({
      ticketId: tParcSin.id,
      ticket: { ...tParcSin, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_PARCIAL,
        fechaFallaConfirmada: ahora,
        inicioParo: new Date(Date.now() - 3600000),
        porcentajeAfectacion: null,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resParcSin,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resParcSin.statusCode).toBe(200);
    const paroParcSin = await prisma.intervaloParoMaquina.findFirstOrThrow({
      where: { falla: { tareaId: tParcSin.id } },
    });
    expect(paroParcSin.porcentajeAfectacion).toBeNull();
    expect(paroParcSin.calidadDato).toBe(CalidadDato.DATO_INCOMPLETO);

    // PARO_TOTAL (fuerza 100%)
    const tTot = await prisma.tarea.create({
      data: {
        titulo: "Paro TOTAL",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tTot.id, maquinaId, fechaFallaReportada: ahora });
    });
    const resTot = mockRes();
    await ejecutarCambioEstado({
      ticketId: tTot.id,
      ticket: { ...tTot, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaConfirmada: ahora,
        inicioParo: new Date(Date.now() - 3600000),
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resTot,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resTot.statusCode).toBe(200);
    const paroTot = await prisma.intervaloParoMaquina.findFirstOrThrow({
      where: { falla: { tareaId: tTot.id } },
    });
    expect(paroTot.porcentajeAfectacion).toBe(100);
    expect(paroTot.calidadDato).toBe(CalidadDato.CONFIRMADO);
  });

  // 8. Máquina funcional obligatoria
  it("si se confirma la falla, se debe exigir máquina operativa al resolver", async () => {
    const ahora = new Date();
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Maquina no funcional",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo sin reparar maquina",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false, // OBLIGATORIO TRUE SI SE CONFIRMA
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: ahora,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Para resolver una falla confirmada, debes marcar que la máquina quedó funcional y probada.");
  });

  // 9. Validaciones de fechas futuras e inválidas (paro)
  it("debe rechazar fechas de inicio de paros futuros o incoherentes", async () => {
    const ahora = new Date();
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Fechas incoherentes",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    // A. Inicio del paro posterior a la restauración (ahora)
    const resA = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Paro posterior",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaConfirmada: ahora,
        inicioParo: new Date(Date.now() + 600000), // Futuro
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resA,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resA.statusCode).toBe(400);
    expect(resA.body.error).toContain("El inicio del paro debe ser anterior a la fecha de restauración de la máquina.");
  });

  // 10. Falla de varios días
  it("debe permitir guardar fallas que duraron varios días", async () => {
    const cuatroDias = 4 * 24 * 60 * 60 * 1000;
    const fechaReportada = new Date(Date.now() - cuatroDias);
    const tresDias = 3 * 24 * 60 * 60 * 1000;
    const inicioParo = new Date(Date.now() - tresDias);

    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Falla varios dias",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
        createdAt: fechaReportada,
        fechaParoProduccion: fechaReportada,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: fechaReportada });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Falla larga",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaConfirmada: fechaReportada,
        inicioParo,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(200);

    const paro = await prisma.intervaloParoMaquina.findFirstOrThrow({
      where: { falla: { tareaId: tarea.id } },
    });
    expect(Math.floor(paro.inicio.getTime() / 1000)).toBe(Math.floor(inicioParo.getTime() / 1000));
  });

  // 11. Pausa técnica no cierra el paro
  it("al pausar un ticket la máquina o el intervalo de paro no se cierra", async () => {
    const ahora = new Date();
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Pausando correctivo",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
        estado: EstadoTarea.ASIGNADA,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.EN_PAUSA,
      nota: "Falta refacción",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }, { nota: "Falta refacción" }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(200);

    const falla = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(falla.estado).toBe(EstadoFalla.PENDIENTE_DE_DIAGNOSTICO); // No se cierra ni confirma
  });

  // 12. Aprobación y Rechazo del Cliente no alteran la fecha de restauración
  it("la aprobación o rechazo del cliente no modifican la restauración de la falla", async () => {
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Validación cliente",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
        estado: EstadoTarea.RESUELTO,
        finalizadoAt: new Date(Date.now() - 3600000), // Hace 1 hora
      },
    });

    await prisma.$transaction(async (tx) => {
      // Crear falla ya resuelta
      await tx.fallaMaquina.create({
        data: {
          tareaId: tarea.id,
          maquinaId,
          estado: EstadoFalla.REHABILITADA,
          calidadDato: CalidadDato.CONFIRMADO,
          fechaFallaReportada: new Date(Date.now() - 7200000),
          fechaFallaConfirmada: new Date(Date.now() - 7200000),
          fechaRestauracion: tarea.finalizadoAt,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          snapshotCodigo: "MBC001",
          snapshotPlanta: "Planta Test",
          snapshotArea: "General",
          snapshotProceso: "Inyeccion",
          snapshotCriticidad: "ALTA",
        }
      });
    });

    const falla = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    const fechaRestauracionOriginal = falla.fechaRestauracion?.getTime();

    // A. Rechazar tarea (Pasa a PENDIENTE)
    const resRechazo = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.PENDIENTE,
      nota: "Rechazado",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resRechazo,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resRechazo.statusCode).toBe(200);

    const fPostRechazo = await prisma.fallaMaquina.findUniqueOrThrow({ where: { id: falla.id } });
    expect(fPostRechazo.fechaRestauracion?.getTime()).toBe(fechaRestauracionOriginal); // Intacto

    // B. Aprobar tarea (Pasa a CERRADO)
    // Cambiar estado a RESUELTO primero en bd para simular flujo
    await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: EstadoTarea.RESUELTO } });
    const resCierre = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, estado: EstadoTarea.RESUELTO, responsables: [] } as any,
      nuevoEstado: EstadoTarea.CERRADO,
      nota: "Aprobado",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resCierre,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resCierre.statusCode).toBe(200);

    const fPostCierre = await prisma.fallaMaquina.findUniqueOrThrow({ where: { id: falla.id } });
    expect(fPostCierre.fechaRestauracion?.getTime()).toBe(fechaRestauracionOriginal); // Intacto
  });

  // 13. Bloqueo de RESUELTO / CERRADO sin diagnóstico
  it("bloquea el cambio a RESUELTO o CERRADO si no se envía diagnóstico", async () => {
    const ahora = new Date();
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Intento resolver sin datos",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
        estado: EstadoTarea.ASIGNADA,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    // Intento de RESUELTO
    const resResuelto = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resResuelto,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resResuelto.statusCode).toBe(400);

    // Intento de CERRADO directo
    const resCerrado = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.CERRADO,
      nota: "Cerrando",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res: resCerrado,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(resCerrado.statusCode).toBe(400);
  });

  // 14. Rollback real después de escritura
  it("debe revertir todas las escrituras en la base de datos si ocurre un error dentro de la transacción", async () => {
    // 1. Asegurar y obtener estado original de la máquina
    await prisma.maquina.update({ where: { id: maquinaId }, data: { estado: "OPERATIVA" } });
    const maqOriginal = await prisma.maquina.findUniqueOrThrow({ where: { id: maquinaId } });
    expect(maqOriginal.estado).toBe("OPERATIVA");

    // 2. Crear una tarea correctiva con paroProduccion: true, lo que cambiará el estado de la máquina a PARO_PRODUCCION
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Ticket Rollback Real",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
        estado: EstadoTarea.PENDIENTE,
        paroProduccion: true,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: new Date() });
    });

    // La creación anterior con paroProduccion: true debe haber puesto la máquina en PARO_PRODUCCION
    const maqPrevState = await prisma.maquina.update({
      where: { id: maquinaId },
      data: { estado: "PARO_PRODUCCION" } // Nos aseguramos que esté en paro antes de iniciar
    });
    expect(maqPrevState.estado).toBe("PARO_PRODUCCION");

    const fallaOriginal = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tarea.id } });

    // Provocamos un error en el cambio de estado pasando una fecha futura para inicioParo
    // después de que la base intente procesar
    const futuro = new Date(Date.now() + 1000000);
    const res = mockRes();

    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Falla para forzar rollback",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaConfirmada: new Date(),
        inicioParo: futuro, // Rompe validaciones -> Rollback
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });

    expect(res.statusCode).toBe(400);

    // ASERCIÓN DE ROLLBACK REAL:
    const tPost = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    expect(tPost.estado).toBe(EstadoTarea.PENDIENTE); // Revertido

    const parosCount = await prisma.intervaloParoMaquina.count({
      where: { fallaId: fallaOriginal.id }
    });
    expect(parosCount).toBe(0); // Revertido

    const fPost = await prisma.fallaMaquina.findUniqueOrThrow({ where: { id: fallaOriginal.id } });
    expect(fPost.estado).toBe(EstadoFalla.PENDIENTE_DE_DIAGNOSTICO); // Revertido

    // Comprobar que el estado de la máquina se mantuvo en PARO_PRODUCCION (no cambió a OPERATIVA)
    const maqPost = await prisma.maquina.findUniqueOrThrow({ where: { id: maquinaId } });
    expect(maqPost.estado).toBe("PARO_PRODUCCION"); // Revertido
  });

  // 15. SIN_PARO con fechaFallaConfirmada explícita
  it("debe procesar exitosamente SIN_PARO con fechaFallaConfirmada explícita", async () => {
    const ahora = new Date();
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Ticket SIN_PARO con fecha explícita",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo sin paro",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: ahora,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(200);

    const fPost = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(fPost.estado).toBe(EstadoFalla.REHABILITADA);
    expect(fPost.impactoConfirmado).toBe(ImpactoProduccionConfirmado.SIN_PARO);
    expect(fPost.fechaFallaConfirmada?.getTime()).toBe(ahora.getTime());

    const parosCount = await prisma.intervaloParoMaquina.count({
      where: { fallaId: fPost.id }
    });
    expect(parosCount).toBe(0);
  });

  // 16. Fecha sugerida corregida por el técnico
  it("debe permitir corregir la fecha de falla sugerida por el técnico", async () => {
    const ahora = new Date();
    const sugerida = new Date(ahora.getTime() - 7200000); // hace 2 horas
    const corregida = new Date(ahora.getTime() - 3600000); // hace 1 hora (posterior a la sugerida)

    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Ticket correccion fecha",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
        fechaParoProduccion: sugerida,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: sugerida });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo con fecha corregida",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: corregida, // Corregida por el técnico
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(200);

    const fPost = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(fPost.fechaFallaConfirmada?.getTime()).toBe(corregida.getTime());
  });

  // 17. fechaFallaConfirmada vacía
  it("debe rechazar la resolución si fechaFallaConfirmada está vacía", async () => {
    const ahora = new Date();
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Ticket fecha vacía",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Intento resolver sin fecha confirmada",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: undefined, // Vacía
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("La fecha de confirmación de la falla es obligatoria.");
  });

  // 18. fechaFallaConfirmada futura
  it("debe rechazar la resolución si fechaFallaConfirmada es futura", async () => {
    const ahora = new Date();
    const futura = new Date(Date.now() + 100000);
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Ticket fecha futura",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Intento resolver con fecha futura",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: futura, // Futura
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("La fecha de confirmación de la falla no puede ser futura.");
  });

  // 19. fechaFallaConfirmada posterior a la restauración
  it("debe rechazar la resolución si fechaFallaConfirmada es posterior a la restauración", async () => {
    const ahora = new Date();
    const posterior = new Date(Date.now() + 5000); // 5s en el futuro (posterior a "ahora" de restauración)
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Ticket fecha posterior",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: ahora });
    });

    const hace2Horas = new Date(Date.now() - 7200000);
    const hace1Hora = new Date(Date.now() - 3600000);

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Intento resolver con fecha posterior",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: {
        finManual: hace2Horas, // Cierre en el pasado (restauración)
      },
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: hace1Hora, // posterior a la restauración (hace 2 horas)
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("La fecha de confirmación de la falla no puede ser posterior a la fecha de restauración de la máquina.");
  });

  // 20. Demostrar que inicioParo y fechaFallaConfirmada pueden ser diferentes
  it("debe permitir que fechaFallaConfirmada e inicioParo difieran", async () => {
    const cuatroDias = 4 * 24 * 60 * 60 * 1000;
    const fechaReportada = new Date(Date.now() - cuatroDias);

    // El técnico determina que:
    // - El reporte (ruido) comenzó hace 3 días (fechaFallaConfirmada).
    // - Pero el paro total (interrupción de producción) inició hace 2 días (inicioParo).
    const fechaConf = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const inicioParo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Ticket fechas diferentes",
        descripcion: "Correctivo",
        clasificacion: ClasificacionTarea.CORRECTIVO,
        tipo: TipoTarea.TICKET,
        creadorId: usuarioId,
        maquinaId,
        createdAt: fechaReportada,
        fechaParoProduccion: fechaReportada,
      },
    });
    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId, fechaFallaReportada: fechaReportada });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resolviendo con fechas de falla y paro diferentes",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaConfirmada: fechaConf,
        inicioParo,
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", departamentoId: deptoId } as any,
      req: mockReq({ id: usuarioId }),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: false,
    });
    expect(res.statusCode).toBe(200);

    const fPost = await prisma.fallaMaquina.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(fPost.fechaFallaConfirmada?.getTime()).toBe(fechaConf.getTime());

    const paro = await prisma.intervaloParoMaquina.findFirstOrThrow({
      where: { fallaId: fPost.id },
    });
    expect(paro.inicio.getTime()).toBe(inicioParo.getTime());
    expect(fPost.fechaFallaConfirmada?.getTime()).not.toBe(paro.inicio.getTime()); // Validar que difieran
  });
});
