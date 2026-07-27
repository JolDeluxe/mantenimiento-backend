import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { registrarError } from "../../../utils/logger";

const KEY_FLAG = "AUTONOMOS_HABILITADOS";

export const getAutonomosGateway = async (req: Request, res: Response) => {
  const rawCodigo = req.query.codigo;
  const codigo = typeof rawCodigo === "string" ? rawCodigo.trim().toUpperCase() : "";

  try {
    // 1. Consultar primero el flag global de autónomos en ConfiguracionSistema
    const config = await prisma.configuracionSistema.findUnique({
      where: { clave: KEY_FLAG }
    });
    const flagHabilitado = config?.valor === "true";

    // 2. Si está apagado, responder únicamente { "habilitado": false } de inmediato (evita enumeración de máquinas)
    if (!flagHabilitado) {
      return res.status(200).json({
        habilitado: false
      });
    }

    // 3. Solo cuando el switch esté encendido: Consultar la existencia de la máquina con selección mínima de campos
    const maquina = await prisma.maquina.findUnique({
      where: { codigo },
      select: {
        codigo: true,
        nombre: true,
        plantillasRevision: {
          where: {
            activa: true,
            plantilla: {
              activa: true,
              aplicaA: {
                in: ["AUTONOMO", "AMBOS"]
              }
            }
          },
          select: {
            plantillaId: true
          },
          take: 1
        }
      }
    });

    if (!maquina) {
      return res.status(404).json({
        error: "Este código no corresponde a un equipo registrado."
      });
    }

    // 4. Retornar los datos mínimos para decidir el comportamiento del gateway
    return res.status(200).json({
      habilitado: true,
      maquina: {
        codigo: maquina.codigo,
        nombre: maquina.nombre
      },
      tienePlantilla: maquina.plantillasRevision.length > 0
    });

  } catch (error) {
    await registrarError("GET_AUTONOMOS_GATEWAY", null, error);
    return res.status(500).json({
      error: "Error interno al consultar el gateway de mantenimiento autónomo."
    });
  }
};
