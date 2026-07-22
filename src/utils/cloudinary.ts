import { v2 as cloudinary } from "cloudinary";
import { env } from "../env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export type CloudinaryUploadInput = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

const resolveMimeType = (input: CloudinaryUploadInput): string => {
  const buffer = input.buffer;
  if (buffer && buffer.length >= 12) {
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return "image/jpeg";
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
    ) {
      return "image/png";
    }
    // WebP: RIFF ... WEBP
    const isRiff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
    const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    if (isRiff && isWebp) {
      return "image/webp";
    }
    // HEIC / HEIF
    const signature = buffer.subarray(4, 12).toString("ascii");
    if (["ftypheic", "ftypheix", "ftyphevc", "ftyphevx", "ftypheim", "ftypheis"].includes(signature)) {
      return "image/heic";
    }
    if (["ftypmif1", "ftypmsf1"].includes(signature)) {
      return "image/heif";
    }
  }

  // Fallback: usar el mimetype provisto si parece válido
  if (input.mimetype && input.mimetype.startsWith("image/") && /^image\/[a-zA-Z0-9.\-+]+$/.test(input.mimetype)) {
    return input.mimetype;
  }

  throw new Error("No se pudo determinar un MIME type válido para la imagen.");
};


export const uploadUserProfileImage = async (buffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "Mantenimiento/Usuarios",
        resource_type: "image",
        transformation: [
          { width: 500, height: 500, crop: "thumb", gravity: "face" },
          { quality: "auto:good" },
          { fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result!.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
};

export const uploadTaskImage = async (input: CloudinaryUploadInput): Promise<string> => {
  const resolvedMime = resolveMimeType(input);
  const dataUri = `data:${resolvedMime};base64,${input.buffer.toString("base64")}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "Mantenimiento/Tareas",
      resource_type: "image",
    });

    if (resolvedMime === "image/heic" || resolvedMime === "image/heif") {
      return cloudinary.url(result.public_id, {
        version: result.version,
        resource_type: "image",
        type: result.type,
        format: "jpg",
        secure: true,
      });
    }

    return result.secure_url;
  } catch (error: any) {
    console.error("Error en uploadTaskImage:", {
      originalname: input.originalname,
      mimetype: input.mimetype,
      size: input.size,
      detectedMime: resolvedMime,
      message: error.message,
      name: error.name,
      http_code: error.http_code,
    });
    throw error;
  }
};

export const deleteImageByUrl = async (imageUrl: string) => {
  if (!imageUrl || !imageUrl.includes("cloudinary")) return;
  if (imageUrl.includes("no-image.avif") || imageUrl.includes("perfil-no-foto")) return;

  try {
    const parts = imageUrl.split("/upload/");
    
    // Validación explícita para calmar al compilador estricto de TypeScript
    const extract = parts[1];
    if (!extract) return;

    let publicIdConExtension = extract.replace(/^v\d+\//, "");
    const publicId = publicIdConExtension.replace(/\.[^/.]+$/, "");

    if (publicId) {
      await cloudinary.uploader.destroy(publicId);
      console.log(`☁️ [Cloudinary] Imagen destruida físicamente: ${publicId}`);
    }
  } catch (error) {
    console.error("🔥 [Cloudinary] Error crítico al intentar eliminar imagen:", error);
  }
};