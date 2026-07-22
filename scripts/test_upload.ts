import { uploadTaskImage } from "../src/utils/cloudinary";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Testing cloudinary upload...");
  // create a dummy image buffer (a 1x1 transparent PNG)
  const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64");
  try {
    const url = await uploadTaskImage(buffer);
    console.log("Upload success:", url);
  } catch (err) {
    console.error("Upload failed:", err);
  }
}

main();
