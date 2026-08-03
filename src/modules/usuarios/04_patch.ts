import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus, EstadoTarea, TipoEvento } from "@prisma/client";
import type { PatchUsuarioInput, PatchUsuarioParams } from "./zod";
import { validarReglasDesactivacion } from "./helper";
import { registrarAccion, registrarError } from "../../utils/logger";

export const getBajaImpactoUsuario = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID de usuario inválido" });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id } });
    if (!usuario) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const tareasActivas = await prisma.tarea.findMany({
      where: {
        estado: { in: [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA] },
        responsables: { some: { id } }
      },
      select: {
        id: true,
        titulo: true,
        estado: true,
        fechaVencimiento: true,
        fechaProgramadaPreventiva: true,
        responsables: {
          select: {
            id: true,
            nombre: true,
            username: true
          }
        }
      }
    });

    const actividadesRecurrentes = await prisma.reglaActividadRecurrente.findMany({
      where: {
        responsables: { some: { id } },
        activo: true
      },
      select: {
        id: true,
        titulo: true,
        categoria: true,
        area: true,
        planta: true,
        responsables: {
          select: {
            id: true,
            nombre: true,
            username: true
          }
        }
      }
    });

    const mantenimientosRecurrentes = await prisma.reglaRecurrencia.findMany({
      where: {
        tecnicoResponsableId: id,
        activo: true
      },
      select: {
        id: true,
        titulo: true,
        frecuencia: true,
        proximaFechaEjecucion: true,
        maquina: {
          select: {
            id: true,
            codigo: true,
            nombre: true
          }
        }
      }
    });

    const tecnicosDisponibles = await prisma.usuario.findMany({
      where: {
        rol: Rol.TECNICO,
        estado: Estatus.ACTIVO,
        id: { not: id }
      },
      select: {
        id: true,
        nombre: true,
        username: true
      }
    });

    return res.json({
      tareasActivas,
      actividadesRecurrentes,
      mantenimientosRecurrentes,
      tecnicosDisponibles
    });

  } catch (error) {
    await registrarError('GET_BAJA_IMPACTO_ERROR', req.user?.id || null, error);
    return res.status(500).json({ error: "No se pudo obtener el impacto de la baja" });
  }
};

export const changeStatusUsuario = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    const { id } = req.params as unknown as PatchUsuarioParams;
    const { estado, reasignaciones } = req.body as PatchUsuarioInput;

    const usuarioObjetivo = await prisma.usuario.findUnique({ where: { id } });

    if (!usuarioObjetivo) return res.status(404).json({ error: "Usuario no encontrado" });

    try {
      validarReglasDesactivacion(usuarioSolicitante, usuarioObjetivo);
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    let usuarioActualizado;

    if (estado === Estatus.INACTIVO && usuarioObjetivo.rol === Rol.TECNICO) {
      // 1. Recalcular impacto actual en BD
      const tareasAbiertas = await prisma.tarea.findMany({
        where: {
          estado: { in: [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA] },
          responsables: { some: { id } }
        },
        select: { id: true }
      });

      const reglasActividades = await prisma.reglaActividadRecurrente.findMany({
        where: {
          responsables: { some: { id } },
          activo: true
        },
        select: { id: true }
      });

      const reglasPreventivas = await prisma.reglaRecurrencia.findMany({
        where: {
          tecnicoResponsableId: id,
          activo: true
        },
        select: { id: true }
      });

      const hasAffectedRecords = tareasAbiertas.length > 0 || reglasActividades.length > 0 || reglasPreventivas.length > 0;

      // 2. Si hay afectaciones, validar que el payload las cubra completamente
      if (hasAffectedRecords) {
        if (!reasignaciones) {
          return res.status(409).json({
            error: "El técnico tiene tareas activas o reglas recurrentes. Se requiere reasignación.",
            code: "IMPACT_CHANGED",
            afectados: {
              tareasAbiertas: tareasAbiertas.length,
              reglasActividades: reglasActividades.length,
              reglasPreventivas: reglasPreventivas.length
            }
          });
        }

        const mappedTareaIds = new Set(reasignaciones.tareas?.map(t => t.tareaId) || []);
        const mappedActividadIds = new Set(reasignaciones.actividadesRecurrentes?.map(a => a.reglaId) || []);
        const mappedPreventivaIds = new Set(reasignaciones.mantenimientosRecurrentes?.map(m => m.reglaId) || []);

        const missingTareas = tareasAbiertas.filter(t => !mappedTareaIds.has(t.id));
        const missingActividades = reglasActividades.filter(a => !mappedActividadIds.has(a.id));
        const missingPreventivas = reglasPreventivas.filter(p => !mappedPreventivaIds.has(p.id));

        if (missingTareas.length > 0 || missingActividades.length > 0 || missingPreventivas.length > 0) {
          return res.status(409).json({
            error: "El impacto ha cambiado o la reasignación está incompleta. Por favor, recargue el impacto.",
            code: "IMPACT_CHANGED",
            afectados: {
              tareasAbiertas: tareasAbiertas.length,
              reglasActividades: reglasActividades.length,
              reglasPreventivas: reglasPreventivas.length
            }
          });
        }

        // Validar todos los técnicos de reemplazo
        const replacementIds = new Set<number>();
        reasignaciones.tareas?.forEach(t => replacementIds.add(t.tecnicoReemplazoId));
        reasignaciones.actividadesRecurrentes?.forEach(a => replacementIds.add(a.tecnicoReemplazoId));
        reasignaciones.mantenimientosRecurrentes?.forEach(m => replacementIds.add(m.tecnicoReemplazoId));

        if (replacementIds.has(id)) {
          return res.status(400).json({ error: "No se puede usar al técnico que se da de baja como reemplazo." });
        }

        if (replacementIds.size > 0) {
          const activeTechs = await prisma.usuario.findMany({
            where: {
              id: { in: Array.from(replacementIds) },
              rol: Rol.TECNICO,
              estado: Estatus.ACTIVO
            },
            select: { id: true }
          });

          if (activeTechs.length !== replacementIds.size) {
            return res.status(400).json({ error: "Uno o más técnicos de reemplazo no son válidos, están inactivos o no tienen rol TECNICO." });
          }
        }
      }

      // 3. Ejecutar transacción atómica
      usuarioActualizado = await prisma.$transaction(async (tx) => {
        const ahora = new Date();

        // A. Cerrar intervalos de tiempo abiertos
        const intervalosAbiertos = await tx.intervaloTiempo.findMany({
          where: { usuarioId: id, fin: null }
        });

        for (const intervalo of intervalosAbiertos) {
          const duracionMinutos = Math.max(1, Math.floor((ahora.getTime() - intervalo.inicio.getTime()) / 60000));
          await tx.intervaloTiempo.update({
            where: { id: intervalo.id },
            data: { fin: ahora, duracion: duracionMinutos }
          });
          await tx.tarea.update({
            where: { id: intervalo.tareaId },
            data: { duracionReal: { increment: duracionMinutos } }
          });
        }

        if (hasAffectedRecords && reasignaciones) {
          // Obtener mapas de nombres de técnicos para el historial
          const replacementIdsArray = Array.from(
            new Set([
              ...(reasignaciones.tareas?.map(t => t.tecnicoReemplazoId) || []),
              ...(reasignaciones.actividadesRecurrentes?.map(a => a.tecnicoReemplazoId) || []),
              ...(reasignaciones.mantenimientosRecurrentes?.map(m => m.tecnicoReemplazoId) || [])
            ])
          );

          const usuariosReemplazo = await tx.usuario.findMany({
            where: { id: { in: replacementIdsArray } },
            select: { id: true, username: true }
          });
          const reemplazoMap = new Map(usuariosReemplazo.map(u => [u.id, u.username]));

          // B. Reasignar tareas abiertas
          if (reasignaciones.tareas) {
            for (const item of reasignaciones.tareas) {
              const usernameReemplazo = reemplazoMap.get(item.tecnicoReemplazoId) || `ID ${item.tecnicoReemplazoId}`;
              await tx.tarea.update({
                where: { id: item.tareaId },
                data: {
                  responsables: {
                    disconnect: { id },
                    connect: { id: item.tecnicoReemplazoId }
                  }
                }
              });

              await tx.historialTarea.create({
                data: {
                  tareaId: item.tareaId,
                  usuarioId: usuarioSolicitante.id,
                  tipo: TipoEvento.ASIGNACION,
                  nota: `Reasignación automática por baja del técnico ${usuarioObjetivo.username}. Nuevo responsable: ${usernameReemplazo}.`
                }
              });
            }
          }

          // C. Reasignar actividades recurrentes
          if (reasignaciones.actividadesRecurrentes) {
            for (const item of reasignaciones.actividadesRecurrentes) {
              await tx.reglaActividadRecurrente.update({
                where: { id: item.reglaId },
                data: {
                  responsables: {
                    disconnect: { id },
                    connect: { id: item.tecnicoReemplazoId }
                  }
                }
              });
            }
          }

          // D. Reasignar mantenimientos preventivos recurrentes
          if (reasignaciones.mantenimientosRecurrentes) {
            for (const item of reasignaciones.mantenimientosRecurrentes) {
              await tx.reglaRecurrencia.update({
                where: { id: item.reglaId },
                data: { tecnicoResponsableId: item.tecnicoReemplazoId }
              });
            }
          }
        }

        // E. Marcar técnico como inactivo
        return await tx.usuario.update({
          where: { id },
          data: { estado: estado as Estatus },
          select: { id: true, nombre: true, username: true, rol: true, estado: true, updatedAt: true }
        });
      });

    } else {
      // Flujo normal para otros roles o si se activa
      usuarioActualizado = await prisma.usuario.update({
        where: { id },
        data: { estado: estado as Estatus },
        select: { id: true, nombre: true, username: true, rol: true, estado: true, updatedAt: true }
      });
    }

    await registrarAccion(
      'CAMBIO_ESTADO_USUARIO',
      usuarioSolicitante.id,
      `Cambió estado a ${estado} para usuario ID: ${id} (${usuarioObjetivo.username})`
    );

    return res.json({ message: `El usuario ha sido marcado como ${estado}`, data: usuarioActualizado });

  } catch (error) {
    await registrarError('PATCH_USUARIO_ERROR', req.user?.id || null, error);
    return res.status(500).json({ error: "No se pudo actualizar el estatus" });
  }
};