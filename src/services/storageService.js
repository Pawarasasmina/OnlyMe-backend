import fs from "node:fs/promises";
import path from "node:path";

export async function storeFile(file) {
  const filename = file?.filename ?? "";

  return {
    id: filename,
    url: filename ? `/uploads/${filename}` : "",
  };
}

export async function deleteStoredFile(url) {
  if (!url?.startsWith("/uploads/")) {
    return;
  }

  const filename = path.basename(url);
  const filePath = path.resolve("uploads", filename);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}
