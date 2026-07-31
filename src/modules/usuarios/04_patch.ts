import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus } from "@prisma/client"; 
import type { PatchUsuarioInput, PatchUsuarioParams } from "./zod";
import { validarReglasDesactivacion } from "./helper"; 
import { registrarAccion, registrarError } from "../../utils/logger";

export const changeStatusUsuario = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    const { id } = req.params as unknown as PatchUsuarioParams;
    const { estado } = req.body as PatchUsuarioInput;

    const usuarioObjetivo = await prisma.usuario.findUnique({ where: { id } });

    if (!usuarioObjetivo) return res.status(404).json({ error: "Usuario no encontrado" });

    try {
      validarReglasDesactivacion(usuarioSolicitante, usuarioObjetivo);
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    let usuarioActualizado;

    if (estado === Estatus.INACTIVO && usuarioObjetivo.rol === Rol.TECNICO) {
      // 1. Detectar registros afectados
      const reglasPreventivas = await prisma.reglaRecurrencia.findMany({
        where: { tecnicoResponsableId: id, activo: true },
        select: { id: true }
      });

      const reglasActividades = await prisma.reglaActividadRecurrente.findMany({
        where: { responsables: { some: { id } }, activo: true },
        include: { responsables: { select: { id: true, estado: true, rol: true } } }
      });

      // Filtrar actividades que quedarían sin ningún técnico activo
      const reglasActividadesAfectadas = reglasActividades.filter(regla => {
        const remainingActiveTechs = regla.responsables.filter(r => r.id !== id && r.estado === Estatus.ACTIVO && r.rol === Rol.TECNICO);
        return remainingActiveTechs.length === 0;
      });

      const reglasActividadesSoloQuitar = reglasActividades.filter(regla => !reglasActividadesAfectadas.includes(regla));

      const tareasAbiertas = await prisma.tarea.findMany({
        where: {
          estado: { in: ["PENDIENTE", "ASIGNADA", "EN_PROGRESO", "EN_PAUSA"] },
          responsables: { some: { id } }
        },
        select: { id: true }
      });

      const hasAffectedRecords = reglasPreventivas.length > 0 || reglasActividadesAfectadas.length > 0 || tareasAbiertas.length > 0;

      // 2. Bloquear si tiene intervalos abiertos
      const intervalosAbiertos = await prisma.intervaloTiempo.count({
        where: { usuarioId: id, fin: null }
      });
      if (intervalosAbiertos > 0) {
        return res.status(409).json({ error: "El técnico tiene intervalos de trabajo abiertos. Debe pausar o cerrar sus tareas primero." });
      }

      const { tecnicoReemplazoId } = req.body as PatchUsuarioInput;
      let reemplazo = null;

      if (hasAffectedRecords) {
        if (!tecnicoReemplazoId || tecnicoReemplazoId === id) {
          return res.status(409).json({
            error: "El técnico tiene reglas recurrentes o tareas abiertas. Se requiere un tecnicoReemplazoId válido y diferente al usuario actual.",
            afectados: {
              reglasPreventivas: reglasPreventivas.length,
              reglasActividades: reglasActividadesAfectadas.length,
              tareasAbiertas: tareasAbiertas.length
            }
          });
        }

        reemplazo = await prisma.usuario.findUnique({ where: { id: tecnicoReemplazoId } });
        if (!reemplazo || reemplazo.estado !== Estatus.ACTIVO || reemplazo.rol !== Rol.TECNICO) {
          return res.status(400).json({ error: "El técnico de reemplazo debe existir, estar ACTIVO y tener rol TECNICO." });
        }
      }

      // 3. Ejecutar transacción
      usuarioActualizado = await prisma.$transaction(async (tx) => {
        if (tecnicoReemplazoId && reemplazo) {
          // Reasignar preventivas
          if (reglasPreventivas.length > 0) {
            await tx.reglaRecurrencia.updateMany({
              where: { tecnicoResponsableId: id, activo: true },
              data: { tecnicoResponsableId: tecnicoReemplazoId }
            });
          }

          // Reasignar actividades que quedarían vacías
          for (const regla of reglasActividadesAfectadas) {
            await tx.reglaActividadRecurrente.update({
              where: { id: regla.id },
              data: { responsables: { disconnect: { id }, connect: { id: tecnicoReemplazoId } } }
            });
          }

          // Reasignar tareas abiertas
          for (const tarea of tareasAbiertas) {
            await tx.tarea.update({
              where: { id: tarea.id },
              data: { responsables: { disconnect: { id }, connect: { id: tecnicoReemplazoId } } }
            });
            await tx.historialTarea.create({
              data: {
                tareaId: tarea.id,
                usuarioId: usuarioSolicitante.id,
                tipo: 'ASIGNACION',
                nota: `Reasignación automática por baja del técnico ${usuarioObjetivo.username}. Nuevo responsable: ${reemplazo.username}.`
              }
            });
          }
        }

        // Remover técnico de las actividades que tienen otros responsables activos
        for (const regla of reglasActividadesSoloQuitar) {
          await tx.reglaActividadRecurrente.update({
            where: { id: regla.id },
            data: { responsables: { disconnect: { id } } }
          });
        }

        // Desactivar usuario
        return await tx.usuario.update({
          where: { id },
          data: { estado: estado as Estatus },
          select: { id: true, nombre: true, username: true, rol: true, estado: true, updatedAt: true }
        });
      });
    } else {
      // Flujo normal para otros roles o si se activa (estado === ACTIVO)
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