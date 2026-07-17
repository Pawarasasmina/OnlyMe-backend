import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../../.env") });
dotenv.config({ path: resolve(__dirname, "../controllers/.env") });

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  accessSecret: process.env.JWT_ACCESS_SECRET || "replace_with_secure_access_secret",
  refreshSecret: process.env.JWT_REFRESH_SECRET || "replace_with_secure_refresh_secret",
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",
  contentMaxFileSize: Math.max(1024, Number(process.env.CONTENT_MAX_FILE_SIZE_BYTES) || 100 * 1024 * 1024),
  verificationStorageRoot: process.env.VERIFICATION_STORAGE_ROOT || "./private/creator-verifications",
  verificationMaxFileSize: Math.max(1024, Number(process.env.VERIFICATION_MAX_FILE_SIZE_BYTES) || 10 * 1024 * 1024),
  enableAdminStarCredits: process.env.ENABLE_ADMIN_STAR_CREDITS === "true",
};

