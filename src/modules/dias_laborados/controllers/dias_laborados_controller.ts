import type { Request, Response } from "express";
import { DiasLaboradosService } from "../services/dias_laborados_service";
import { diasLaboradosQuerySchema } from "../zod";

export class DiasLaboradosController {
  static async obtener(req: Request, res: Response): Promise<void> {
    try {
      // 1. Validar parámetros de entrada con el esquema Zod
      const parsed = diasLaboradosQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Parámetros de consulta inválidos",
          details: parsed.error.format()
        });
        return;
      }

      // 2. Invocar el servicio de negocio
      const resultado = await DiasLaboradosService.obtener(parsed.data);

      // 3. Responder al cliente
      res.json(resultado);
    } catch (error: any) {
      console.error("Error en DiasLaboradosController:", error);
      res.status(500).json({
        success: false,
        error: "Error interno del servidor al obtener días laborados",
        message: error.message
      });
    }
  }
}
