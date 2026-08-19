import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const rootEnv = dotenv.config({ path: resolve(__dirname, "../../.env") });
dotenv.config({ path: resolve(__dirname, "../controllers/.env"), override: true });

for (const key of ["NODE_ENV", "PORT", "CLIENT_URL"]) {
  if (rootEnv.parsed?.[key]) {
    process.env[key] = rootEnv.parsed[key];
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3104,
  mongoUri: process.env.MONGODB_URI,
  accessSecret: process.env.JWT_ACCESS_SECRET || "replace_with_secure_access_secret",
  refreshSecret: process.env.JWT_REFRESH_SECRET || "replace_with_secure_refresh_secret",
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "",
  emailTimeoutMs: Math.max(1000, Number(process.env.EMAIL_TIMEOUT_MS) || 10000),
  trustProxy: Math.max(0, Number(process.env.TRUST_PROXY_HOPS) || (process.env.NODE_ENV === "production" ? 1 : 0)),
  apiRateLimit: Math.max(100, Number(process.env.API_RATE_LIMIT) || 2000),
  authRateLimit: Math.max(5, Number(process.env.AUTH_RATE_LIMIT) || 20),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",
  contentMaxFileSize: Math.max(1024, Number(process.env.CONTENT_MAX_FILE_SIZE_BYTES) || 100 * 1024 * 1024),
  verificationMaxFileSize: Math.max(1024, Number(process.env.VERIFICATION_MAX_FILE_SIZE_BYTES) || 10 * 1024 * 1024),
  enableAdminStarCredits: process.env.ENABLE_ADMIN_STAR_CREDITS === "true",
  stunUrls: (process.env.WEBRTC_STUN_URLS || "stun:stun.l.google.com:19302").split(",").map((value) => value.trim()).filter(Boolean),
  turnUrls: (process.env.WEBRTC_TURN_URLS || "").split(",").map((value) => value.trim()).filter(Boolean),
  turnUsername: process.env.WEBRTC_TURN_USERNAME || "",
  turnCredential: process.env.WEBRTC_TURN_CREDENTIAL || "",
  turnSecret: process.env.WEBRTC_TURN_SECRET || "",
};

