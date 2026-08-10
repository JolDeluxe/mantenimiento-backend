import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "../../src/db";
import { Rol, Estatus, EstadoTarea, EstadoFalla, ImpactoProduccionConfirmado } from "@prisma/client";
import { ejecutarCambioEstado } from "../../src/modules/tickets/status/_core";
import { crearFallaProvisional } from "../../src/modules/bi_maquinaria/services/confirmacion_falla_service";
import { recalcularEstadoMaquina } from "../../src/modules/maquinas/helper";

const PREFIX = `TEST_REC_${Date.now()}`;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.includes("_test")) {
  console.error("DATABASE_URL DE INTEGRACIÓN INCORRECTA:", databaseUrl);
  throw new Error("ABORTANDO: Las pruebas de integración deben correr exclusivamente con DATABASE_URL apuntando a una base de pruebas que termine en '_test' (mantenimiento_test).");
}

describe("BI Maquinaria - Recalcular Estado Maquina Integration Tests", () => {
  let deptoId: number;
  let usuarioId: number;
  let maquinasCreadas: number[] = [];

  beforeAll(async () => {
    const depto = await prisma.departamento.create({
      data: {
        nombre: `${PREFIX}_Depto`,
        planta: "Planta Test",
        tipo: "Produccion"
      }
    });
    deptoId = depto.id;

    const user = await prisma.usuario.create({
      data: {
        username: `${PREFIX}_admin`,
        nombre: "Super Admin Test",
        email: `admin_${PREFIX}@cuadra.com`,
        password: "securepassword",
        rol: Rol.SUPER_ADMIN,
        estado: Estatus.ACTIVO,
        departamentoId: deptoId
      }
    });
    usuarioId = user.id;
  });

  afterAll(async () => {
    await prisma.intervaloParoMaquina.deleteMany({ where: { maquinaId: { in: maquinasCreadas } } });
    await prisma.fallaMaquina.deleteMany({ where: { maquinaId: { in: maquinasCreadas } } });
    await prisma.intervaloTiempo.deleteMany({ where: { usuarioId } });
    await prisma.historialTarea.deleteMany({ where: { usuarioId } });
    await prisma.tarea.deleteMany({ where: { creadorId: usuarioId } });
    await prisma.maquina.deleteMany({ where: { id: { in: maquinasCreadas } } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
    await prisma.departamento.delete({ where: { id: deptoId } });
  });

  const crearMaquina = async (sufijo: string) => {
    const m = await prisma.maquina.create({
      data: {
        codigo: `${PREFIX}_${sufijo}`,
        nombre: `Maquina ${sufijo}`,
        proceso: "Inyección",
        estado: "OPERATIVA",
        planta: "Planta Test",
        area: "General"
      }
    });
    maquinasCreadas.push(m.id);
    return m.id;
  };

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

  const mockReq = (body: any = {}) => {
    return {
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: `admin_${PREFIX}@cuadra.com`, nombre: "Admin" },
      body,
      files: [],
      protocol: "http",
      get: () => "localhost"
    } as any;
  };

  it("1. crear reporte sin paro no cambia a EN_REPARACION (permanece OPERATIVA)", async () => {
    const mId = await crearMaquina("T1");

    // Crear tarea sin paro
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Reporte sin paro",
        descripcion: "Falla menor",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: false,
        estado: EstadoTarea.PENDIENTE,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    await recalcularEstadoMaquina(mId);

    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("OPERATIVA");
  });

  it("2. crear reporte con paro cambia a PARO_PRODUCCION", async () => {
    const mId = await crearMaquina("T2");

    // Crear tarea con paro
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Reporte con paro",
        descripcion: "Falla grave",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: true,
        estado: EstadoTarea.PENDIENTE,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    await recalcularEstadoMaquina(mId);

    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("PARO_PRODUCCION");
  });

  it("3. iniciar trabajo sin paro cambia a EN_REPARACION", async () => {
    const mId = await crearMaquina("T3");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo sin paro",
        descripcion: "Falla",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: false,
        estado: EstadoTarea.PENDIENTE,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [{ id: usuarioId }] } as any,
      nuevoEstado: EstadoTarea.EN_PROGRESO,
      nota: "Iniciando trabajo",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "admin@test.com", nombre: "Admin" } as any,
      req: mockReq(),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: true
    });

    expect(res.statusCode).toBe(200);
    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("EN_REPARACION");
  });

  it("4. una tarea ASIGNADA no coloca la máquina en EN_REPARACION (permanece OPERATIVA)", async () => {
    const mId = await crearMaquina("T4");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo Asignado",
        descripcion: "Falla",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: false,
        estado: EstadoTarea.ASIGNADA,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    await recalcularEstadoMaquina(mId);

    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("OPERATIVA");
  });

  it("5. una tarea EN_PAUSA conserva EN_REPARACION", async () => {
    const mId = await crearMaquina("T5");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo Pausado",
        descripcion: "Falla",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: false,
        estado: EstadoTarea.EN_PAUSA,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    await recalcularEstadoMaquina(mId);

    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("EN_REPARACION");
  });

  it("6. un paro activo tiene prioridad sobre EN_REPARACION (conserva PARO_PRODUCCION al iniciar)", async () => {
    const mId = await crearMaquina("T6");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo con Paro",
        descripcion: "Falla",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: true,
        estado: EstadoTarea.PENDIENTE,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    // Iniciar trabajo
    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [{ id: usuarioId }] } as any,
      nuevoEstado: EstadoTarea.EN_PROGRESO,
      nota: "Iniciando",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "admin@test.com", nombre: "Admin" } as any,
      req: mockReq(),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: true
    });

    expect(res.statusCode).toBe(200);
    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    // Conserva PARO_PRODUCCION en lugar de bajar a EN_REPARACION
    expect(m.estado).toBe("PARO_PRODUCCION");
  });

  it("7. cancelar antes de iniciar vuelve a OPERATIVA", async () => {
    const mId = await crearMaquina("T7");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo M7",
        descripcion: "Falla",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: true,
        estado: EstadoTarea.PENDIENTE,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    await prisma.maquina.update({ where: { id: mId }, data: { estado: "PARO_PRODUCCION" } });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.CANCELADA,
      nota: "Cancelar",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "admin@test.com", nombre: "Admin" } as any,
      req: mockReq(),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: true
    });

    expect(res.statusCode).toBe(200);
    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("OPERATIVA");
  });

  it("8. cancelar después de iniciar cierra IntervaloTiempo y vuelve a OPERATIVA", async () => {
    const mId = await crearMaquina("T8");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo M8",
        descripcion: "Falla",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: true,
        estado: EstadoTarea.EN_PROGRESO,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    await prisma.intervaloTiempo.create({
      data: {
        tareaId: tarea.id,
        usuarioId,
        estado: EstadoTarea.EN_PROGRESO,
        inicio: new Date()
      }
    });

    await prisma.maquina.update({ where: { id: mId }, data: { estado: "EN_REPARACION" } });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.CANCELADA,
      nota: "Cancelar",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "admin@test.com", nombre: "Admin" } as any,
      req: mockReq(),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: true
    });

    expect(res.statusCode).toBe(200);

    const intAbierto = await prisma.intervaloTiempo.findFirst({
      where: { tareaId: tarea.id, fin: null }
    });
    expect(intAbierto).toBeNull();

    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("OPERATIVA");
  });

  it("9. cancelar una tarea no afecta otra tarea activa en la misma máquina", async () => {
    const mId = await crearMaquina("T9");

    const tarea1 = await prisma.tarea.create({
      data: {
        titulo: "Tarea Activa M9",
        descripcion: "Trabajo activo",
        creadorId: usuarioId,
        maquinaId: mId,
        estado: EstadoTarea.EN_PROGRESO,
        clasificacion: "CORRECTIVO"
      }
    });

    const tarea2 = await prisma.tarea.create({
      data: {
        titulo: "Tarea a Cancelar M9",
        descripcion: "Falla",
        creadorId: usuarioId,
        maquinaId: mId,
        estado: EstadoTarea.PENDIENTE,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      await crearFallaProvisional(tx, { tareaId: tarea1.id, maquinaId: mId, fechaFallaReportada: new Date() });
      await crearFallaProvisional(tx, { tareaId: tarea2.id, maquinaId: mId, fechaFallaReportada: new Date() });
    });

    await prisma.maquina.update({ where: { id: mId }, data: { estado: "EN_REPARACION" } });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea2.id,
      ticket: { ...tarea2, responsables: [] } as any,
      nuevoEstado: EstadoTarea.CANCELADA,
      nota: "Cancelar",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: false,
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "admin@test.com", nombre: "Admin" } as any,
      req: mockReq(),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: true
    });

    expect(res.statusCode).toBe(200);
    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("EN_REPARACION");
  });

  it("10. resolver cierra los intervalos y recalcula correctamente (vuelve a OPERATIVA)", async () => {
    const mId = await crearMaquina("T10");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo M10",
        descripcion: "Falla con paro",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: true,
        estado: EstadoTarea.EN_PROGRESO,
        clasificacion: "CORRECTIVO"
      }
    });

    await prisma.$transaction(async (tx) => {
      const f = await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
      await tx.fallaMaquina.update({
        where: { id: f.id },
        data: { estado: EstadoFalla.ABIERTA, fechaFallaConfirmada: new Date() }
      });
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resuelto",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaConfirmada: new Date()
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "admin@test.com", nombre: "Admin" } as any,
      req: mockReq(),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: true
    });

    expect(res.statusCode).toBe(200);
    const m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("OPERATIVA");
  });

  it("11. Cerrar un paro: el mismo IntervaloParoMaquina debe quedar con fin válido", async () => {
    const mId = await crearMaquina("T11");
    const tarea = await prisma.tarea.create({
      data: {
        titulo: "Correctivo M11",
        descripcion: "Falla con paro",
        creadorId: usuarioId,
        maquinaId: mId,
        paroProduccion: true,
        estado: EstadoTarea.EN_PROGRESO,
        clasificacion: "CORRECTIVO"
      }
    });

    let fallaId = 0;
    await prisma.$transaction(async (tx) => {
      const f = await crearFallaProvisional(tx, { tareaId: tarea.id, maquinaId: mId, fechaFallaReportada: new Date() });
      fallaId = f.id;
      await tx.fallaMaquina.update({
        where: { id: f.id },
        data: { estado: EstadoFalla.ABIERTA, fechaFallaConfirmada: new Date() }
      });
    });

    // Crear un IntervaloParoMaquina con fin=null
    const ipm = await prisma.intervaloParoMaquina.create({
      data: {
        maquina: { connect: { id: mId } },
        falla: { connect: { id: fallaId } },
        tarea: { connect: { id: tarea.id } },
        tipo: "NO_PLANIFICADO",
        impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
        confirmadoPor: { connect: { id: usuarioId } },
        inicio: new Date(Date.now() - 30 * 60 * 1000),
        fin: null,
        porcentajeAfectacion: 100
      }
    });

    const res = mockRes();
    await ejecutarCambioEstado({
      ticketId: tarea.id,
      ticket: { ...tarea, responsables: [] } as any,
      nuevoEstado: EstadoTarea.RESUELTO,
      nota: "Resuelto",
      imagenesFinales: [],
      fechaVencimiento: undefined,
      refacciones: undefined,
      registroTiempoManual: undefined,
      maquinaOperativaAlResolver: true,
      fallaResolucion: {
        descartar: false,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaConfirmada: new Date(),
        inicioParo: new Date(Date.now() - 30 * 60 * 1000)
      },
      user: { id: usuarioId, rol: "SUPER_ADMIN", email: "admin@test.com", nombre: "Admin" } as any,
      req: mockReq(),
      res,
      autoCloseInspeccion: false,
      manejarIntervalos: true
    });

    expect(res.statusCode).toBe(200);

    // Consultar exactamente por el ID del IntervaloParoMaquina creado y verificar que ya no sea null
    const ipmCerrado = await prisma.intervaloParoMaquina.findUniqueOrThrow({
      where: { id: ipm.id }
    });
    expect(ipmCerrado.fin).not.toBeNull();
  });

  it("12. BAJA e INACTIVA: no deben sobreescribirse", async () => {
    const mId = await crearMaquina("T12");

    // Probar BAJA
    await prisma.maquina.update({ where: { id: mId }, data: { estado: "BAJA" } });
    await recalcularEstadoMaquina(mId);
    let m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("BAJA");

    // Probar INACTIVA
    await prisma.maquina.update({ where: { id: mId }, data: { estado: "INACTIVA" } });
    await recalcularEstadoMaquina(mId);
    m = await prisma.maquina.findUniqueOrThrow({ where: { id: mId } });
    expect(m.estado).toBe("INACTIVA");
  });
});
