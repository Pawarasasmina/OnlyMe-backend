import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const rootEnv = dotenv.config({ path: resolve(__dirname, "../../.env") });
dotenv.config({ path: resolve(__dirname, "../controllers/.env"), override: true });

for (const key of ["NODE_ENV", "PORT", "CLIENT_URL", "LARA_ACCESS_KEY_ID", "LARA_ACCESS_KEY_SECRET", "LARA_TRANSLATION_TIMEOUT_MS"]) {
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
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:5000/api/auth/google/callback",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "",
  emailTimeoutMs: Math.max(1000, Number(process.env.EMAIL_TIMEOUT_MS) || 10000),
  trustProxy: Math.max(0, Number(process.env.TRUST_PROXY_HOPS) || (process.env.NODE_ENV === "production" ? 1 : 0)),
  apiRateLimit: Math.max(100, Number(process.env.API_RATE_LIMIT) || 2000),
  authRateLimit: Math.max(5, Number(process.env.AUTH_RATE_LIMIT) || 20),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
  deepgramTranscriptionModel: process.env.DEEPGRAM_TRANSCRIPTION_MODEL || "nova-3",
  laraAccessKeyId: process.env.LARA_ACCESS_KEY_ID || "",
  laraAccessKeySecret: process.env.LARA_ACCESS_KEY_SECRET || "",
  laraTranslationTimeoutMs: Math.max(1000, Number(process.env.LARA_TRANSLATION_TIMEOUT_MS) || 15000),
  contentMaxFileSize: Math.max(1024, Number(process.env.CONTENT_MAX_FILE_SIZE_BYTES) || 100 * 1024 * 1024),
  verificationMaxFileSize: Math.max(1024, Number(process.env.VERIFICATION_MAX_FILE_SIZE_BYTES) || 10 * 1024 * 1024),
  maxVoiceNoteDurationSeconds: Math.max(1, Number(process.env.MAX_VOICE_NOTE_DURATION_SECONDS) || 300),
  maxVoiceNoteSizeBytes: Math.max(1, Number(process.env.MAX_VOICE_NOTE_SIZE_MB) || 20) * 1024 * 1024,
  enableAdminStarCredits: process.env.ENABLE_ADMIN_STAR_CREDITS === "true",
  uploadScanWebhookSecret: process.env.UPLOAD_SCAN_WEBHOOK_SECRET || "",
  stunUrls: (process.env.WEBRTC_STUN_URLS || "stun:stun.l.google.com:19302").split(",").map((value) => value.trim()).filter(Boolean),
  turnUrls: (process.env.WEBRTC_TURN_URLS || "").split(",").map((value) => value.trim()).filter(Boolean),
  turnUsername: process.env.WEBRTC_TURN_USERNAME || "",
  turnCredential: process.env.WEBRTC_TURN_CREDENTIAL || "",
  turnSecret: process.env.WEBRTC_TURN_SECRET || "",
  mongoMaxPoolSize: Math.max(5, Number(process.env.MONGODB_MAX_POOL_SIZE) || 20),
  mongoMinPoolSize: Math.max(0, Number(process.env.MONGODB_MIN_POOL_SIZE) || 1),
  requestTimeoutMs: Math.max(5000, Number(process.env.HTTP_REQUEST_TIMEOUT_MS) || 30000),
  headersTimeoutMs: Math.max(6000, Number(process.env.HTTP_HEADERS_TIMEOUT_MS) || 35000),
  keepAliveTimeoutMs: Math.max(1000, Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS) || 5000),
  shutdownTimeoutMs: Math.max(5000, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 30000),
  maintenanceWorkersEnabled: process.env.MAINTENANCE_WORKERS_ENABLED !== "false",
  uptimeAlertWebhook: process.env.UPTIME_ALERT_WEBHOOK || "",
};

export function validateProductionEnv() {
  if (env.nodeEnv !== "production") return;

  const errors = [];
  const insecureSecrets = new Set(["", "replace_with_secure_access_secret", "replace_with_secure_refresh_secret"]);
  if (!env.mongoUri) errors.push("MONGODB_URI is required");
  if (insecureSecrets.has(env.accessSecret) || env.accessSecret.length < 32) errors.push("JWT_ACCESS_SECRET must be a unique secret of at least 32 characters");
  if (insecureSecrets.has(env.refreshSecret) || env.refreshSecret.length < 32) errors.push("JWT_REFRESH_SECRET must be a unique secret of at least 32 characters");
  if (env.accessSecret === env.refreshSecret) errors.push("JWT access and refresh secrets must be different");
  if (!process.env.MAINTENANCE_WORKERS_ENABLED) errors.push("MAINTENANCE_WORKERS_ENABLED must explicitly be true or false in production");
  try { new URL(env.clientUrl); } catch { errors.push("CLIENT_URL must be a valid URL"); }
  if (env.mongoMinPoolSize > env.mongoMaxPoolSize) errors.push("MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE");
  if (env.headersTimeoutMs <= env.requestTimeoutMs) errors.push("HTTP_HEADERS_TIMEOUT_MS must be greater than HTTP_REQUEST_TIMEOUT_MS");

  if (errors.length) throw new Error(`Unsafe production configuration:\n- ${errors.join("\n- ")}`);
}

