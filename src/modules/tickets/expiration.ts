import { prisma } from "../../db";
import { EstadoTarea } from "@prisma/client";
import { deleteImageByUrl } from "../../utils/cloudinary";
import type { TicketWithDetails } from "./types";

const DIAS_PARA_EXPIRAR = 7;
const PATH_IMAGEN_PLACEHOLDER = "/img/no-image.avif"; 

export const checkTicketExpiration = async (ticket: TicketWithDetails, reqHost: string): Promise<TicketWithDetails> => {
    const estadosFinales: EstadoTarea[] = [
        EstadoTarea.CERRADO, 
        EstadoTarea.CANCELADA, 
        EstadoTarea.RECHAZADO, 
        EstadoTarea.RESUELTO
    ];
    
    if (!estadosFinales.includes(ticket.estado) || !ticket.finalizadoAt) {
        return ticket;
    }

    const fechaFinalizado = new Date(ticket.finalizadoAt);
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - DIAS_PARA_EXPIRAR);

    if (fechaFinalizado > fechaLimite) {
        return ticket;
    }

    const imagenesParaBorrar = ticket.imagenes.filter((img) => 
        !img.url.includes("no-image.avif") && img.tipo !== "EXPIRADO"
    );

    if (imagenesParaBorrar.length === 0) {
        return ticket; 
    }

    const urlCompletaPlaceholder = `${reqHost}${PATH_IMAGEN_PLACEHOLDER}`;

    imagenesParaBorrar.forEach((img) => {
        deleteImageByUrl(img.url).catch(console.error);
    });

    await prisma.imagen.updateMany({
        where: {
            id: { in: imagenesParaBorrar.map((i) => i.id) }
        },
        data: {
            url: urlCompletaPlaceholder,
            tipo: "EXPIRADO"
        }
    });

    // AQUÍ ESTÁ LA CORRECCIÓN: Aseguramos la inmutabilidad tanto en la raíz como en el historial
    return {
        ...ticket,
        imagenes: ticket.imagenes.map((img) => {
            if (imagenesParaBorrar.some((b) => b.id === img.id)) {
                return { ...img, url: urlCompletaPlaceholder, tipo: "EXPIRADO" };
            }
            return img;
        }),
        historial: ticket.historial.map((evento) => ({
            ...evento,
            imagenes: evento.imagenes.map((img) => {
                // En types.ts no se seleccionó el 'id' para historial.imagenes, 
                // así que validamos directamente contra la URL comprometida.
                if (imagenesParaBorrar.some((b) => b.url === img.url)) {
                    return { ...img, url: urlCompletaPlaceholder, tipo: "EXPIRADO" };
                }
                return img;
            })
        }))
    };
};