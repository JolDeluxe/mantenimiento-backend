import { prisma } from "../../db";
import { EstadoTarea } from "@prisma/client";
import { deleteImageByUrl } from "../../utils/cloudinary";
import type { TicketWithDetails } from "./types";

const DIAS_PARA_EXPIRAR = 1;
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

    return {
        ...ticket,
        imagenes: ticket.imagenes.map((img) => {
            if (imagenesParaBorrar.some((b) => b.id === img.id)) {
                return { ...img, url: urlCompletaPlaceholder, tipo: "EXPIRADO" };
            }
            return img;
        })
    };
};