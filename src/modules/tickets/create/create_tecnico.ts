import type { Request, Response } from "express";
import { prisma } from "../../../db";
import { EstadoTarea, TipoEvento, TipoTarea, ClasificacionTarea, Prioridad, ImpactoProduccionConfirmado, Rol } from "@prisma/client";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { createTicketTecnicoSchema } from "../zod";
import { processTicketImages } from "./helper_upload";
import {
  crearFallaProvisional,
  confirmarFallaEnTransaccion,
  resolverFallaEnTransaccion,
} from "../../bi_maquinaria/services/confirmacion_falla_service";
import { recalcularEstadoMaquina } from "../../maquinas/helper";
import { notificarCambioEstatus, ejecutarNotificacionEnSegundoPlano } from "../../notificaciones/services";

export const createTicketTecnico = async (req: Request, res: Response) => {
  const user = req.user!;

  try {
    // 1. Validar input mediante Zod
    const validation = createTicketTecnicoSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Datos de formulario inválidos",
        details: validation.error.issues,
      });
    }

    const data = validation.data;
    const ahora = new Date();

    // 2. Resolver ubicación (Máquina o Área General)
    let finalPlanta: string | null = data.planta ?? null;
    let finalArea: string | null = data.area ?? "";
    let finalCategoria: string = data.categoria || "INFRAESTRUCTURA";
    let finalClasificacion: ClasificacionTarea | null = null;

    if (data.maquinaId) {
      const maquinaDb = await prisma.maquina.findUnique({
        where: { id: data.maquinaId },
        select: { id: true, nombre: true, codigo: true, planta: true, area: true, estado: true },
      });

      if (!maquinaDb) {
        return res.status(400).json({ error: "La máquina seleccionada no existe." });
      }

      finalPlanta = maquinaDb.planta;
      finalArea = maquinaDb.area;
      finalCategoria = "MAQUINARIA";
      finalClasificacion = data.clasificacion === "PREVENTIVO" 
        ? ClasificacionTarea.PREVENTIVO 
        : ClasificacionTarea.CORRECTIVO;
    } else {
      finalClasificacion = null;
    }

    // 3. Subir imágenes si existen (máximo 3)
    const files = req.files as Express.Multer.File[] | undefined;
    let urlsImagenes: string[] = [];
    if (files && files.length > 0) {
      if (files.length > 3) {
        return res.status(400).json({ error: "Máximo 3 imágenes permitidas por tarea." });
      }
      urlsImagenes = await processTicketImages(files);
    }

    // 4. Determinar estado y tiempos según 'yaTerminado'
    const esTerminado = Boolean(data.yaTerminado);
    const estadoInicial = esTerminado ? EstadoTarea.CERRADO : EstadoTarea.ASIGNADA;

    // Detectar si el técnico usó rango horario (inicioManual/finManual) o solo duración en minutos.
    // Esto determina si se conocen tiempos reales o solo la duración total.
    const usaRangoHorario = esTerminado && Boolean(data.inicioManual && data.finManual);

    let fechaInicio: Date | null = null;
    let finalizadoAt: Date | null = null;
    let duracionRealMinutos: number | null = null;
    // esTiempoManual: true cuando el tiempo fue declarado manualmente (vs medido por el sistema).
    // false: sistema lo midió. true+rango: se conocen inicio/fin reales. true+minutos: solo duración conocida.
    let registroEsTiempoManual = false;

    if (esTerminado) {
      duracionRealMinutos = data.duracionMinutos || 1;
      registroEsTiempoManual = true; // siempre manual en registro directo técnico

      if (usaRangoHorario) {
        // El técnico ingresó inicio y fin reales — usarlos directamente.
        fechaInicio  = data.inicioManual!;
        finalizadoAt = data.finManual!;
        // Recalcular duración a partir del rango real para consistencia.
        const diffMs = finalizadoAt.getTime() - fechaInicio.getTime();
        if (diffMs > 0) {
          duracionRealMinutos = Math.round(diffMs / 60000);
        }
      } else {
        // El técnico solo ingresó minutos — NO inventar una hora de inicio.
        // Se guarda fechaInicio = null para que el modal de detalle no muestre un horario ficticio.
        fechaInicio  = null;
        finalizadoAt = ahora;
      }
    }

    // 5. Descripción vs Nota de cierre:
    // - Tarea pendiente (yaTerminado=false): la descripcion es el contexto del trabajo a realizar.
    // - Tarea terminada (yaTerminado=true): lo que el técnico escribió es una nota de cierre
    // 5. Descripción vs Nota de cierre:
    // - Tarea pendiente (yaTerminado=false): la descripcion es el contexto del trabajo a realizar.
    // - Tarea terminada (yaTerminado=true): lo que el técnico escribió es una nota de cierre
    //   que va al historial. La descripcion del ticket queda como el título o nota breve.
    const descripcionTicket: string = esTerminado
      ? (data.descripcion || data.titulo || "Trabajo concluido directamente.")
      : (data.descripcion || "Sin descripción.");
    const notaCierre: string | null = esTerminado ? (data.nota || data.descripcion || null) : null;

    // Si hubo paro de producción, calcular el impacto en minutos.
    // Si ya terminó: diferencia entre finalizadoAt e inicio del paro (fechaParoProduccion o ahora).
    let impactoProduccionMinutos: number | null = null;
    if (Boolean(data.paroProduccion)) {
      if (esTerminado && finalizadoAt) {
        const tInicioParo = data.fechaParoProduccion ?? ahora;
        const diffParoMs = finalizadoAt.getTime() - tInicioParo.getTime();
        impactoProduccionMinutos = diffParoMs > 0 ? Math.round(diffParoMs / 60000) : duracionRealMinutos;
      } else if (data.fechaParoProduccion) {
        const diffParoMs = ahora.getTime() - data.fechaParoProduccion.getTime();
        impactoProduccionMinutos = diffParoMs > 0 ? Math.round(diffParoMs / 60000) : null;
      }
    }

    // 5. Ejecución atómica en transacción
    const result = await prisma.$transaction(async (tx) => {
      // 5.1 Crear la tarea forzando reglas inmutables
      const nuevaTarea = await tx.tarea.create({
        data: {
          titulo: data.titulo,
          descripcion: descripcionTicket,
          prioridad: Prioridad.MEDIA,
          categoria: finalCategoria,
          planta: finalPlanta,
          area: finalArea,
          clasificacion: finalClasificacion,
          tipo: TipoTarea.EXTRAORDINARIA,
          estado: estadoInicial,
          tiempoEstimado: duracionRealMinutos ?? 0,
          duracionReal: duracionRealMinutos,
          fechaInicio,
          finalizadoAt,
          creadorId: user.id,
          departamentoId: user.departamentoId,
          responsables: {
            connect: [{ id: user.id }],
          },
          maquinaId: data.maquinaId ?? null,
          paroProduccion: Boolean(data.paroProduccion),
          fechaParoProduccion: data.fechaParoProduccion ?? (data.paroProduccion ? ahora : null),
          impactoProduccion: impactoProduccionMinutos,
        },
        include: {
          responsables: true,
        },
      });

      // 5.2 Historial de creación
      await tx.historialTarea.create({
        data: {
          tareaId: nuevaTarea.id,
          usuarioId: user.id,
          tipo: TipoEvento.CREACION,
          estadoNuevo: estadoInicial,
          nota: esTerminado
            ? "Trabajo directo concluido registrado por el técnico."
            : "Tarea extraordinaria autoasignada registrada por el técnico.",
        },
      });

      // 5.3 Si ya se terminó: registrar evento de cambio de estado y bloque de intervalo de tiempo
      if (esTerminado) {
        // Nota del cierre: incluye la nota escrita por el técnico + duración registrada + META:TIEMPO_MANUAL
        const partesNota = [
          usaRangoHorario
            ? `Trabajo finalizado directamente (rango horario). Duración: ${duracionRealMinutos} min.`
            : `Trabajo finalizado directamente. Duración declarada: ${duracionRealMinutos} min.`,
        ];
        if (notaCierre) {
          partesNota.push(`Nota técnico: ${notaCierre}`);
        }
        partesNota.push("||[META:TIEMPO_MANUAL]||");
        const notaHistorialCierre = partesNota.join("\n\n").trim();

        await tx.historialTarea.create({
          data: {
            tareaId: nuevaTarea.id,
            usuarioId: user.id,
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: EstadoTarea.ASIGNADA,
            estadoNuevo: EstadoTarea.CERRADO,
            nota: notaHistorialCierre,
          },
        });

        // Registrar tiempo en IntervaloTiempo para productividad y métricas
        await tx.intervaloTiempo.create({
          data: {
            tareaId: nuevaTarea.id,
            usuarioId: user.id,
            inicio: fechaInicio ?? new Date(ahora.getTime() - duracionRealMinutos! * 60000),
            fin: finalizadoAt!,
            duracion: duracionRealMinutos!,
            estado: EstadoTarea.CERRADO,
          },
        });

        // Si es máquina, actualizar fechaUltimoServicio
        if (nuevaTarea.maquinaId) {
          await tx.maquina.update({
            where: { id: nuevaTarea.maquinaId },
            data: { fechaUltimoServicio: finalizadoAt! },
          });
        }
      }

      // 5.4 Gestión de BI y Fallas para Correctivos de Maquinaria
      if (nuevaTarea.clasificacion === ClasificacionTarea.CORRECTIVO && nuevaTarea.maquinaId) {
        const fechaReporteFalla = nuevaTarea.fechaParoProduccion || nuevaTarea.createdAt;

        // Crear Falla provisional
        const falla = await crearFallaProvisional(tx, {
          tareaId: nuevaTarea.id,
          maquinaId: nuevaTarea.maquinaId,
          fechaFallaReportada: fechaReporteFalla,
        });

        if (esTerminado) {
          // El técnico confirma y resuelve la falla en el acto
          await confirmarFallaEnTransaccion(tx, {
            fallaId: falla.id,
            tecnicoId: user.id,
            fechaFallaConfirmada: fechaReporteFalla,
          });

          const huboParo = Boolean(data.paroProduccion);
          const impactoFinal = huboParo
            ? (data.impactoConfirmado || ImpactoProduccionConfirmado.PARO_TOTAL)
            : ImpactoProduccionConfirmado.SIN_PARO;

          let inicioParoReal: Date | undefined = undefined;
          if (huboParo) {
            inicioParoReal = data.fechaParoProduccion ? new Date(data.fechaParoProduccion) : fechaInicio!;
            if (inicioParoReal >= finalizadoAt!) {
              inicioParoReal = new Date(finalizadoAt!.getTime() - (duracionRealMinutos! * 60000));
            }
          }

          await resolverFallaEnTransaccion({
            tx,
            fallaId: falla.id,
            maquinaId: nuevaTarea.maquinaId,
            tecnicoId: user.id,
            fechaRestauracion: finalizadoAt!,
            impactoConfirmado: impactoFinal,
            inicioParo: inicioParoReal,
            porcentajeAfectacion: impactoFinal === ImpactoProduccionConfirmado.PARO_TOTAL ? 100 : null,
          });

          await recalcularEstadoMaquina(nuevaTarea.maquinaId, tx, {
            tareaId: nuevaTarea.id,
            nuevoEstado: EstadoTarea.CERRADO,
            paroProduccion: huboParo,
            maquinaOperativaAlResolver: data.maquinaOperativaAlResolver ?? true,
          });
        }
      } else if (esTerminado && nuevaTarea.maquinaId) {
        // Preventivo en máquina terminado: sincronizar estado operativo
        await recalcularEstadoMaquina(nuevaTarea.maquinaId, tx, {
          tareaId: nuevaTarea.id,
          nuevoEstado: EstadoTarea.CERRADO,
          paroProduccion: false,
          maquinaOperativaAlResolver: true,
        });
      }

      // 5.5 Guardar imágenes si existen
      if (urlsImagenes.length > 0) {
        await tx.imagen.createMany({
          data: urlsImagenes.map((url) => ({
            tareaId: nuevaTarea.id,
            url,
          })),
        });
      }

      return nuevaTarea;
    });

    await registrarAccion(
      esTerminado ? "REGISTRO_DIRECTO_TERMINADO" : "REGISTRO_DIRECTO_ASIGNADO",
      user.id,
      `Técnico #${user.id} registró ${esTerminado ? 'trabajo terminado' : 'tarea pendiente'}: "${result.titulo}" (ID: ${result.id})`
    );

    // Notificación en segundo plano si aplica
    ejecutarNotificacionEnSegundoPlano(
      "NOTIF_REGISTRO_TECNICO",
      notificarCambioEstatus(
        result,
        estadoInicial,
        user.id,
        Rol.TECNICO
      )
    );

    return res.status(201).json({
      status: "success",
      message: esTerminado
        ? "Trabajo registrado y concluido exitosamente."
        : "Tarea creada y asignada a tu lista de hoy.",
      data: {
        ticket: result,
      },
    });
  } catch (error: any) {
    await registrarError("CREATE_TICKET_TECNICO", user?.id ?? null, error);
    return res.status(500).json({
      error: "Error interno al registrar el trabajo.",
      details: error.message || error,
    });
  }
};
