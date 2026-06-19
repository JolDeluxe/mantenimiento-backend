import multer from "multer";

const storage = multer.memoryStorage();

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, 
  },
  fileFilter: (_req, file, cb) => {
    const isImageMime = file.mimetype.startsWith("image/");
    const hasHeicExt = /\.(heic|heif)$/i.test(file.originalname);
    
    if (isImageMime || hasHeicExt) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos de imagen (Formatos aceptados: JPEG, PNG, WEBP, HEIC)"));
    }
  },
});