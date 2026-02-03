import { uploadTaskImage } from "../../../utils/cloudinary";

export const processTicketImages = async (files: Express.Multer.File[] | undefined): Promise<string[]> => {
    if (!files || files.length === 0) return [];

    const urls: string[] = [];

    for (const file of files) {
        try {
            const url = await uploadTaskImage(file.buffer);
            urls.push(url);
        } catch (error) {
            console.error("Error subiendo una de las imágenes:", error);
            // Opcional: Si falla una, lanzamos error para cancelar todo
            throw new Error("Falló la subida de una imagen");
        }
    }
    
    return urls;
};