import type { Request, Response } from "express";
import { prisma } from "../../db";
import { EstadoTarea, TipoEvento, Rol, ClasificacionTarea } from "@prisma/client";
import { registrarError, registrarAccion } from "../../utils/logger";
import { processTicketImages } from "./create/helper_upload";
import { notificarCambioEstatus } from "../notificaciones/services"; 
import { calcularMinutosEntreFechas, isValidTransition } from "./helper";
import type { ChangeTicketStatusParams, ChangeTicketStatusInput } from "./zod";

export const changeTicketStatus = async (req: Request, res: Response) => {
  const user = req.user!;
  const { id: ticketId } = req.params as unknown as ChangeTicketStatusParams;
  const data = req.body as ChangeTicketStatusInput;

  try {
    const files = req.files as Express.Multer.File[] | undefined;
    const urlsImagenes = await processTicketImages(files);
    
    if (urlsImagenes.length > 0) {
      data.imagenes = urlsImagenes;
    }
  
    const { estado: nuevoEstado, nota, imagenes: imagenesFinales = [], registroTiempoManual } = data;

    const ticket = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: { responsables: true } 
    });

    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    const esCliente    = user.rol === Rol.CLIENTE_INTERNO;
    const esTecnico    = user.rol === Rol.TECNICO;
    const esAdminJefe  = ([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO] as Rol[]).includes(user.rol);
    const esCreador    = ticket.creadorId === user.id;
    const esResponsable = ticket.responsables.some(r => r.id === user.id);
    const esRutina     = ticket.clasificacion === ClasificacionTarea.RUTINA;

    // --- VALIDACIÓN DE PERMISOS ---

    if (!isValidTransition(ticket.estado, nuevoEstado)) {
        return res.status(400).json({ 
            error: `Transición no permitida: ${ticket.estado} → ${nuevoEstado}` 
        });
        }

    if (esCliente) {
      if (!esCreador) {
        return res.status(403).json({ error: "No puedes modificar un ticket que no es tuyo." });
      }
      if (ticket.estado !== EstadoTarea.RESUELTO) {
        return res.status(403).json({ error: "Solo puedes validar el ticket cuando el técnico lo marque como RESUELTO." });
      }
      if (nuevoEstado !== EstadoTarea.CERRADO && nuevoEstado !== EstadoTarea.RECHAZADO) {
        return res.status(400).json({ error: "Como cliente, solo puedes CERRAR o RECHAZAR el ticket." });
      }
    } else if (esTecnico) {
      if (!esResponsable) {
        return res.status(403).json({ error: "No estás asignado a este ticket." });
      }
      if (nuevoEstado === EstadoTarea.CERRADO && !esRutina) {
        return res.status(403).json({ error: "Solo el cliente o el jefe pueden cerrar el ticket definitivamente." });
      }
      if (ticket.estado === EstadoTarea.PENDIENTE) {
        return res.status(400).json({ error: "El ticket debe ser asignado antes de iniciarlo." });
      }
    } else if (!esAdminJefe) {
      return res.status(403).json({ error: "No tienes permisos para cambiar el estatus." });
    }

    const ahora = new Date();
    const datosActualizacion: Record<string, unknown> = { estado: nuevoEstado, updatedAt: ahora };

    // --- GESTIÓN DE INTERVALOS AUTOMÁTICOS ---

    // Inicio de cronómetro al pasar a EN_PROGRESO
    if (nuevoEstado === EstadoTarea.EN_PROGRESO && ticket.estado !== EstadoTarea.EN_PROGRESO) {
      if (!ticket.fechaInicio) datosActualizacion.fechaInicio = ahora;
      
      await prisma.intervaloTiempo.create({
        data: {
          tareaId: ticketId,
          usuarioId: user.id,
          inicio: ahora,
          estado: EstadoTarea.EN_PROGRESO
        }
      });
    }

    // Cierre de cronómetro automático al salir de EN_PROGRESO
    if (ticket.estado === EstadoTarea.EN_PROGRESO && nuevoEstado !== EstadoTarea.EN_PROGRESO) {
      const intervaloAbierto = await prisma.intervaloTiempo.findFirst({
        where: { tareaId: ticketId, fin: null },
        orderBy: { inicio: 'desc' }
      });

      if (intervaloAbierto) {
        const duracionMin = Math.floor(
          (ahora.getTime() - intervaloAbierto.inicio.getTime()) / 60000
        );
        await prisma.intervaloTiempo.update({
          where: { id: intervaloAbierto.id },
          data: { fin: ahora, duracion: duracionMin }
        });
        await prisma.tarea.update({
          where: { id: ticketId },
          data: { duracionReal: { increment: duracionMin } }
        });
      }
    }

    // --- GESTIÓN DE TIEMPO MANUAL RETROACTIVO ---
    // Se aplica cuando la tarea va a un estado de resolución (RESUELTO o CERRADO para rutinas)
    // y el técnico declara el tiempo trabajado que no fue medido automáticamente.

    const esEstadoResolucion = nuevoEstado === EstadoTarea.RESUELTO ||
      (esRutina && nuevoEstado === EstadoTarea.CERRADO);

    let minutosAdicionalesManual = 0;
    let inicioIntervaloManual: Date = ahora;
    let finIntervaloManual: Date = ahora;
    let hayTiempoManual = false;

    if (esEstadoResolucion && registroTiempoManual) {
      if (registroTiempoManual.inicioManual && registroTiempoManual.finManual) {
        // Forma A: rango de fechas
        inicioIntervaloManual = new Date(registroTiempoManual.inicioManual);
        finIntervaloManual    = new Date(registroTiempoManual.finManual);
        minutosAdicionalesManual = calcularMinutosEntreFechas(inicioIntervaloManual, finIntervaloManual);
      } else if (registroTiempoManual.duracionManualMinutos) {
        // Forma B: duración directa en minutos
        minutosAdicionalesManual = registroTiempoManual.duracionManualMinutos;
        // Reconstruimos el intervalo hacia atrás desde "ahora" para tener fechas consistentes
        finIntervaloManual    = ahora;
        inicioIntervaloManual = new Date(ahora.getTime() - minutosAdicionalesManual * 60000);
      }

      if (minutosAdicionalesManual > 0) {
        hayTiempoManual = true;

        await prisma.intervaloTiempo.create({
          data: {
            tareaId:  ticketId,
            usuarioId: user.id,
            // Se marca como EN_PROGRESO para representar trabajo activo, igual que los automáticos
            estado:   EstadoTarea.EN_PROGRESO,
            inicio:   inicioIntervaloManual,
            fin:      finIntervaloManual,
            duracion: minutosAdicionalesManual
          }
        });

        await prisma.tarea.update({
          where: { id: ticketId },
          data: { duracionReal: { increment: minutosAdicionalesManual } }
        });
      }
    }

    // --- FECHAS DE CICLO DE VIDA ---

    // fechaInicio retroactiva: si la tarea nunca pasó por EN_PROGRESO (flujo offline)
    // y se tiene el inicio manual, lo usamos como referencia histórica real.
    if (esEstadoResolucion && !ticket.fechaInicio) {
      datosActualizacion.fechaInicio = hayTiempoManual ? inicioIntervaloManual : ahora;
    }

    if (nuevoEstado === EstadoTarea.RESUELTO || nuevoEstado === EstadoTarea.CERRADO) {
      if (!ticket.finalizadoAt) datosActualizacion.finalizadoAt = ahora;
    }

    if (nuevoEstado === EstadoTarea.RECHAZADO) {
      datosActualizacion.finalizadoAt = null;
    }

    // --- TRANSACCIÓN PRINCIPAL ---
    const result = await prisma.$transaction(async (tx) => {
      const tareaActualizada = await tx.tarea.update({
        where: { id: ticketId },
        data: datosActualizacion
      });

      // Construcción de la nota de auditoría
      let notaHistorial = nota || `Cambio de estado: ${ticket.estado} → ${nuevoEstado}`;

      if (esRutina && nuevoEstado === EstadoTarea.CERRADO) {
        notaHistorial += ' (Rutina Completada)';
      }

      if (hayTiempoManual) {
        notaHistorial += ` [⏱ Tiempo declarado manualmente: ${minutosAdicionalesManual} minuto${minutosAdicionalesManual !== 1 ? 's' : ''}]`;
      }

      const historial = await tx.historialTarea.create({
        data: {
          tareaId:       ticketId,
          usuarioId:     user.id,
          tipo:          TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: ticket.estado,
          estadoNuevo:   nuevoEstado,
          nota:          notaHistorial
        }
      });

      if (imagenesFinales.length > 0) {
        let tipoEvidencia = "EVIDENCIA_AVANCE";
        if (nuevoEstado === EstadoTarea.RESUELTO)  tipoEvidencia = "EVIDENCIA_SOLUCION";
        else if (nuevoEstado === EstadoTarea.RECHAZADO) tipoEvidencia = "EVIDENCIA_RECHAZO";
        else if (nuevoEstado === EstadoTarea.CERRADO)   tipoEvidencia = "EVIDENCIA_CIERRE";

        await tx.imagen.createMany({
          data: imagenesFinales.map(url => ({
            url,
            tipo:       tipoEvidencia,
            tareaId:    ticketId,
            historialId: historial.id
          }))
        });
      }

      return tareaActualizada;
    });

    void notificarCambioEstatus(ticket, nuevoEstado, user.id);
    await registrarAccion(
      "CAMBIO_ESTATUS",
      user.id,
      `Ticket ${ticketId}: ${ticket.estado} → ${nuevoEstado} (Usuario: ${user.email})${hayTiempoManual ? ` | Tiempo manual: ${minutosAdicionalesManual} min` : ''}`
    );
    
    return res.json({ message: "Estatus actualizado correctamente", data: result });

  } catch (error) {
    await registrarError('CHANGE_STATUS', user.id, error);
    return res.status(500).json({ error: "Error al cambiar estado" });
  }
};
// ```

// ---

// **Contrato de uso para el frontend (cuando lo desarrolles):**

// El endpoint `PATCH /api/tickets/:id/status` ahora acepta el campo opcional `registroTiempoManual`. Se envía como JSON string en FormData (por ser multipart):
// ```
// // Forma A — con fechas
// registroTiempoManual = '{"inicioManual":"2026-03-19T08:00:00-06:00","finManual":"2026-03-19T10:30:00-06:00"}'

// // Forma B — con minutos directos  
// registroTiempoManual = '{"duracionManualMinutos":90}'