import { uploadTaskImage } from "./src/utils/cloudinary";

async function main() {
  console.log("Testing cloudinary upload using the real module...");
  const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64");
  try {
    const url = await uploadTaskImage(buffer);
    console.log("Upload success:", url);
  } catch (err) {
    console.error("Upload failed:", err);
  }
}

main();
