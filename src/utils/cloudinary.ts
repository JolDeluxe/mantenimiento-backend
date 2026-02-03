import { v2 as cloudinary } from "cloudinary";
import { env } from "../env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

// console.log("Cloudinary OK:", cloudinary.config().cloud_name);

export const uploadUserProfileImage = async (buffer: Buffer): Promise<string> => {
  const base64 = buffer.toString("base64");
  const dataUri = `data:image/jpeg;base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "Mantenimiento/Usuarios",
    resource_type: "image",
    transformation: [
      { width: 500, height: 500, crop: "thumb", gravity: "face" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
  });

  return result.secure_url;
};

export const uploadTaskImage = async (buffer: Buffer): Promise<string> => {
  const base64 = buffer.toString("base64");
  const dataUri = `data:image/jpeg;base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "Mantenimiento/Tareas",
    resource_type: "image",
    transformation: [
      { width: 1280, crop: "limit" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
  });

  return result.secure_url;
};

export const deleteImageByUrl = async (imageUrl: string) => {
  if (!imageUrl || !imageUrl.includes("cloudinary")) return;
  if (imageUrl.includes("no-image.avif")) return;

  const regexId = /\/v\d+\/(.+)\.[a-z]+$/;
  const matchId = imageUrl.match(regexId);

  if (matchId?.[1]) {
    await cloudinary.uploader.destroy(matchId[1]);
  }
};
