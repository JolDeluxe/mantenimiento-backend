import { prisma } from "../../db";
import { EstadoTarea } from "@prisma/client";
import { deleteImageByUrl } from "../../utils/cloudinary";

// const MESES_PARA_EXPIRAR = 1;
const DIAS_PARA_EXPIRAR = 1;
const PATH_IMAGEN_PLACEHOLDER = "/img/no-image.avif"; 

export const checkTicketExpiration = async (ticket: any, reqHost: string) => {
    // 1. Validar si aplica expiración
    const estadosFinales = [
        EstadoTarea.CERRADO, 
        EstadoTarea.CANCELADA, 
        EstadoTarea.RECHAZADO, 
        EstadoTarea.RESUELTO
    ];
    
    // Si no cumple condiciones básicas, retornamos el ticket original intacto
    if (!ticket || !estadosFinales.includes(ticket.estado) || !ticket.finalizadoAt) {
        return ticket;
    }

    // 2. Calcular fechas
    const fechaFinalizado = new Date(ticket.finalizadoAt);
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - DIAS_PARA_EXPIRAR);
    // fechaLimite.setMonth(fechaLimite.getMonth() - MESES_PARA_EXPIRAR);

    // Si la fecha de finalización es MÁS RECIENTE que el límite, no hacemos nada
    if (fechaFinalizado > fechaLimite) {
        return ticket;
    }

    // 3. Detectar imágenes que necesitan borrado
    const imagenesParaBorrar = ticket.imagenes.filter((img: any) => 
        !img.url.includes("no-image.avif") && img.tipo !== "EXPIRADO"
    );

    if (imagenesParaBorrar.length === 0) {
        return ticket; 
    }

    // 4. EJECUTAR LIMPIEZA
    const urlCompletaPlaceholder = `${reqHost}${PATH_IMAGEN_PLACEHOLDER}`;

    // Borrado físico en Cloudinary
    imagenesParaBorrar.forEach((img: any) => {
        deleteImageByUrl(img.url).catch(console.error);
    });

    // Actualización en BD
    await prisma.imagen.updateMany({
        where: {
            id: { in: imagenesParaBorrar.map((i: any) => i.id) }
        },
        data: {
            url: urlCompletaPlaceholder,
            tipo: "EXPIRADO"
        }
    });

    // 5. Retornar el objeto ticket modificado
    return {
        ...ticket,
        imagenes: ticket.imagenes.map((img: any) => {
            if (imagenesParaBorrar.some((b: any) => b.id === img.id)) {
                return { ...img, url: urlCompletaPlaceholder, tipo: "EXPIRADO" };
            }
            return img;
        })
    };
};