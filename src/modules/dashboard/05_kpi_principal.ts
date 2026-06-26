import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { calcularKpiTarea, calcularKpiAgregado, colorParaKpi, toMXDateStr } from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO, Rol.TECNICO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
const ESTADOS_ACTIVOS: EstadoTarea[] = [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA];
const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const toPct = (val: number, total: number): number => total > 0 ? Number(((val / total) * 100).toFixed(2)) : 0;

export const getKpiPrincipal = async (req: Request, res: Response) => {
    try {
        const user = req.user!;
        if (!ROLES_CON_ACCESO.includes(user.rol)) return res.status(403).json({ error: "Acceso denegado." });

        const ahora = new Date();
        const mesIdx = ahora.getMonth();
        const anio = ahora.getFullYear();
        
        // Límites del mes actual
        const fechaInicio = new Date(anio, mesIdx, 1, 0, 0, 0, 0);
        const fechaFin = new Date(anio, mesIdx + 1, 0, 23, 59, 59, 999);

        // Límites del mes anterior (Para Tendencia MoM)
        const prevMesInicio = new Date(anio, mesIdx - 1, 1, 0, 0, 0, 0);
        const prevMesFin = new Date(anio, mesIdx, 0, 23, 59, 59, 999);

        // Mañana (Para backlog urgente)
        const manana = new Date(ahora);
        manana.setDate(manana.getDate() + 1);
        manana.setHours(23, 59, 59, 999);

        // 🚨 CORRECCIÓN: El Jefe y Coordinador ven TODAS las tareas (igual que en 01 y 03)
        const baseWhere: Prisma.TareaWhereInput = { estado: { not: EstadoTarea.CANCELADA } };
        
        if (user.rol === Rol.TECNICO) {
            baseWhere.responsables = { some: { id: user.id } };
        }

        // 🚨 Identificamos a los usuarios que sí pertenecen al departamento del Jefe
        const targetDeptoId = user.rol === Rol.SUPER_ADMIN ? null : user.departamentoId;
        const validUsersQuery = (user.rol === Rol.JEFE_MTTO || user.rol === Rol.SUPER_ADMIN || user.rol === Rol.COORDINADOR_MTTO)
            ? prisma.usuario.findMany({
                where: {
                    rol: Rol.TECNICO,
                    ...(targetDeptoId ? { departamentoId: targetDeptoId } : {})
                },
                select: { id: true }
            })
            : Promise.resolve([]);

        // Ejecutar consultas pesadas en paralelo
        const [tareasActuales, tareasAnteriores, tareasUrgentesDB, cargaRealDB, validUsersRaw] = await Promise.all([
            prisma.tarea.findMany({
                where: { ...baseWhere, createdAt: { gte: fechaInicio, lte: fechaFin } },
                select: {
                    id: true, estado: true, finalizadoAt: true, fechaVencimiento: true, 
                    duracionReal: true, tiempoEstimado: true, clasificacion: true, categoria: true, area: true,
                    historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
                    responsables: { select: { id: true, nombre: true, rol: true } }
                }
            }),
            prisma.tarea.findMany({
                where: { ...baseWhere, createdAt: { gte: prevMesInicio, lte: prevMesFin } },
                select: { estado: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true, historial: { select: { id: true }, take: 1 } }
            }),
            prisma.tarea.findMany({
                where: { ...baseWhere, estado: { in: ESTADOS_ACTIVOS }, fechaVencimiento: { lte: manana } },
                select: { id: true, titulo: true, estado: true, fechaVencimiento: true, prioridad: true },
                orderBy: { fechaVencimiento: 'asc' },
                take: 6
            }),
            user.rol === Rol.TECNICO || user.rol === Rol.COORDINADOR_MTTO ? prisma.intervaloTiempo.aggregate({
                where: { usuarioId: user.id, fin: { not: null }, tarea: { ...baseWhere, createdAt: { gte: fechaInicio, lte: fechaFin } } },
                _sum: { duracion: true }
            }) : Promise.resolve({ _sum: { duracion: null } }),
            validUsersQuery
        ]);

        const validUserIds = new Set(validUsersRaw.map(u => u.id));

        // --- 1. KPI GLOBAL Y TENDENCIA ---
        const termActuales = tareasActuales.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
        const kpiAct = calcularKpiAgregado(termActuales.map(t => calcularKpiTarea(t as any)));
        const kpiGlobal = termActuales.length === 0 ? null : Number(kpiAct.kpiPromedio.toFixed(2));

        const termPrev = tareasAnteriores.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
        const kpiPrev = calcularKpiAgregado(termPrev.map(t => calcularKpiTarea(t as any)));
        
        let trend: number | null = null;
        if (kpiGlobal !== null && termPrev.length > 0) {
            trend = Number((kpiGlobal - kpiPrev.kpiPromedio).toFixed(2));
        }

        // --- 2. DESGLOSE DE RESUMEN ---
        const conRechazos = termActuales.filter(t => t.historial.length > 0).length;
        const tasaAceptacion = termActuales.length === 0 ? null : toPct(termActuales.length - conRechazos, termActuales.length);

        const conFecha = termActuales.filter(t => t.finalizadoAt && t.fechaVencimiento);
        const aTiempoCount = conFecha.filter(t => toMXDateStr(new Date(t.finalizadoAt!)) <= toMXDateStr(new Date(t.fechaVencimiento!))).length;
        const indiceCumplimiento = conFecha.length > 0 ? toPct(aTiempoCount, conFecha.length) : null;

        let estTotal = 0, realTotal = 0;
        termActuales.forEach(t => {
            if (t.tiempoEstimado && t.tiempoEstimado > 0) {
                estTotal += t.tiempoEstimado;
                realTotal += (t.duracionReal || 0);
            }
        });
        const desviacion = estTotal > 0 ? Number((((realTotal - estTotal) / estTotal) * 100).toFixed(2)) : null;

        const conteosPorEstado: Record<string, number> = {};
        tareasActuales.forEach(t => { conteosPorEstado[t.estado] = (conteosPorEstado[t.estado] || 0) + 1; });

        // --- 3. MÓDULOS ESPECÍFICOS POR ROL ---
        const dataEspecial: any = {};

        if (user.rol === Rol.TECNICO || user.rol === Rol.COORDINADOR_MTTO) {
            const minsReales = cargaRealDB._sum.duracion ?? 0;
            const minsEstimados = tareasActuales.reduce((acc, t) => acc + (t.tiempoEstimado || 0), 0);
            dataEspecial.tiempos = {
                realMins: minsReales,
                estimadoMins: minsEstimados,
                consumoPct: minsEstimados > 0 ? Math.round((minsReales / minsEstimados) * 100) : null
            };

            const catMap = new Map<string, number>();
            tareasActuales.forEach(t => {
                const c = t.categoria || "SIN_CATEGORIA";
                catMap.set(c, (catMap.get(c) || 0) + 1);
            });
            dataEspecial.topCategorias = Array.from(catMap.entries())
                .map(([nombre, cantidad]) => ({ nombre, cantidad }))
                .sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);
        }

        if (user.rol === Rol.JEFE_MTTO || user.rol === Rol.SUPER_ADMIN || user.rol === Rol.COORDINADOR_MTTO) {
            const techMap = new Map<number, { nombre: string, kpis: number[] }>();
            
            termActuales.forEach(t => {
                t.responsables.forEach(r => {
                    // 🚨 CORRECCIÓN: Solo agregamos si es técnico y pertenece a nuestra área
                    if (r.rol === Rol.TECNICO && validUserIds.has(r.id)) {
                        if (!techMap.has(r.id)) {
                            techMap.set(r.id, { nombre: r.nombre.split(' ')[0] ?? r.nombre, kpis: [] });
                        }
                        techMap.get(r.id)!.kpis.push(calcularKpiTarea(t as any));
                    }
                });
            });
            
            dataEspecial.topEquipo = Array.from(techMap.values())
                .filter(t => t.kpis.length >= 2) 
                .map(t => ({ 
                    nombre: t.nombre, 
                    // 🚨 CORRECCIÓN: 2 Decimales exactos
                    kpi: Number((t.kpis.reduce((a,b)=>a+b,0)/t.kpis.length).toFixed(2)) 
                }))
                .sort((a, b) => b.kpi - a.kpi).slice(0, 3);

            const areaMap = new Map<string, number>();
            tareasActuales.forEach(t => {
                const a = t.area || "GENERAL";
                areaMap.set(a, (areaMap.get(a) || 0) + 1);
            });
            dataEspecial.topAreas = Array.from(areaMap.entries())
                .map(([nombre, cantidad]) => ({ nombre, cantidad }))
                .sort((a, b) => b.cantidad - a.cantidad).slice(0, 4);
        }

        const hoyMX = toMXDateStr(new Date());
        const ESTADOS_ACTIVOS_VENCIBLES: string[] = ['PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RECHAZADO'];

        const urgentesMapeadas = tareasUrgentesDB.map(t => {
            const isOverdue =
                ESTADOS_ACTIVOS_VENCIBLES.includes(t.estado) &&
                !!t.fechaVencimiento &&
                toMXDateStr(new Date(t.fechaVencimiento)) < hoyMX;
            return {
                ...t,
                isOverdue
            };
        });

        return res.json({
            status: "success",
            data: {
                periodo: { mes: mesIdx + 1, anio, etiqueta: `${MESES_ES[mesIdx]} ${anio}` },
                resumen: {
                    totalGeneradas: tareasActuales.length,
                    kpiGlobal,
                    kpiColor: kpiGlobal !== null ? colorParaKpi(kpiGlobal) : "neutral",
                    kpiDatosSuficientes: kpiAct.datosSuficientes,
                    trend,
                    tasaAceptacion,
                    tasaAceptacionColor: tasaAceptacion !== null ? colorParaKpi(tasaAceptacion) : "neutral",
                    indiceCumplimiento,
                    indiceCumplimientoColor: indiceCumplimiento !== null ? colorParaKpi(indiceCumplimiento) : "neutral",
                    desviacionEstimacionGlobal: desviacion,
                    desviacionColor: desviacion === null ? 'neutral' : (desviacion <= 10 ? 'verde' : desviacion <= 30 ? 'ambar' : 'rojo'),
                },
                conteosPorEstado,
                urgentes: urgentesMapeadas,
                ...dataEspecial
            }
        });

    } catch (error) {
        await registrarError("DASHBOARD_PRINCIPAL", req.user?.id ?? null, error);
        return res.status(500).json({ error: "Error al cargar el dashboard principal." });
    }
};