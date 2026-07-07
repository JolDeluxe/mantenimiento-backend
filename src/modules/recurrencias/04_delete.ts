// src/modules/recurrencias/04_delete.ts
// DELETE /api/recurrencias/:id
//
// DISEÑO (alineado con el plan aprobado):
//   - Baja LÓGICA: activo = false. No se borra la regla ni los tickets históricos.
//   - Si en el futuro se quiere borrado físico, se expone como endpoint separado
//     con autorización SUPER_ADMIN exclusiva.
import type { Request, Response } from "express";
import { prisma } from "../../db";

export const deleteRegla = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const regla = await prisma.reglaRecurrencia.findUnique({
      where: { id },
      select: { id: true, activo: true, titulo: true },
    });
    if (!regla) {
      return res.status(404).json({ error: "Regla de recurrencia no encontrada" });
    }

    if (!regla.activo) {
      return res.json({ mensaje: "La regla ya estaba inactiva", reglaId: id });
    }

    // Baja lógica
    await prisma.reglaRecurrencia.update({
      where: { id },
      data: { activo: false },
    });

    // Los tickets ya generados (históricos) NO se tocan.
    // Los tickets en estado PENDIENTE/ASIGNADA pueden quedar como están
    // o ser cancelados manualmente por el equipo. No los cancelamos
    // automáticamente para no destruir trabajo ya planificado sin aviso.

    return res.json({
      mensaje: `Regla "${regla.titulo}" desactivada. Los tickets históricos no fueron modificados.`,
      reglaId: id,
    });
  } catch (error) {
    console.error("[recurrencias] deleteRegla error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
