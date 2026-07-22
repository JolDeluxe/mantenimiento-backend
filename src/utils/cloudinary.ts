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

const detectHeicMime = (input: CloudinaryUploadInput): "image/heic" | "image/heif" | null => {
  // 1. Magic Bytes (Máxima prioridad)
  if (input.buffer && input.buffer.length >= 12) {
    const signature = input.buffer.subarray(4, 12).toString("ascii");
    if (["ftypheic", "ftypheix", "ftyphevc", "ftyphevx", "ftypheim", "ftypheis"].includes(signature)) {
      return "image/heic";
    }
    if (["ftypmif1", "ftypmsf1"].includes(signature)) {
      return "image/heif";
    }
  }

  // 2. Extensión
  if (input.originalname) {
    if (/\.heic$/i.test(input.originalname)) return "image/heic";
    if (/\.heif$/i.test(input.originalname)) return "image/heif";
  }

  // 3. MIME
  if (input.mimetype === "image/heic") return "image/heic";
  if (input.mimetype === "image/heif") return "image/heif";

  return null;
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
  const heicMime = detectHeicMime(input);

  if (heicMime !== null) {
    const dataUri = `data:${heicMime};base64,${input.buffer.toString("base64")}`;
    try {
      const result = await cloudinary.uploader.upload(dataUri, {
        folder: "Mantenimiento/Tareas",
        resource_type: "image",
      });
      return cloudinary.url(result.public_id, {
        version: result.version,
        resource_type: "image",
        type: result.type,
        format: "jpg",
        secure: true,
      });
    } catch (error) {
      console.error("Error en uploadTaskImage (HEIC/HEIF):", error);
      throw error;
    }
  }

  // Flujo normal para JPEG, PNG, WEBP, etc.
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "Mantenimiento/Tareas",
        resource_type: "image",
        transformation: [
          { width: 1280, crop: "limit" },
          { quality: "auto:good" },
          { fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result!.secure_url);
      }
    );
    uploadStream.end(input.buffer);
  });
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