import express from "express";
import path from "node:path";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import routes from "./routes/index.js";
import manualBankRoutes from "./routes/manualBankRoutes.js";
import identityRoutes from "./routes/identityRoutes.js";
import { stripeIdentityWebhook } from "./controllers/stripeIdentityWebhook.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorMiddleware.js";
import { notFoundHandler } from "./middleware/notFoundMiddleware.js";
import { assertPrivateStorageConfiguration } from "./services/privateDocumentStorageService.js";
import mongoose from "mongoose";
import { uptimeAlertMiddleware } from "./middleware/uptimeAlertMiddleware.js";

assertPrivateStorageConfiguration();


const app = express();
app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", env.trustProxy);
const allowedOrigins = new Set([
  env.clientUrl,
  env.clientUrl?.replace("localhost", "127.0.0.1"),
  env.clientUrl?.replace("127.0.0.1", "localhost"),
].filter(Boolean));

function isLocalDevOrigin(origin) {
  if (env.nodeEnv === "production") {
    return false;
  }

  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(uptimeAlertMiddleware);
app.get("/api/health/live", (_req, res) => res.status(200).json({ success: true, message: "OnlyMe API process is alive", data: {} }));
app.get("/api/health/ready", (_req, res) => {
  const ready = !app.get("shuttingDown") && mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({ success: ready, message: ready ? "OnlyMe API is ready" : "Database is unavailable", data: {} });
});
app.post("/api/identity/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeIdentityWebhook);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/uploads", express.static(path.resolve("uploads"), {
  etag: true,
  lastModified: true,
  maxAge: env.nodeEnv === "production" ? "7d" : 0,
  setHeaders(res) {
    if (env.nodeEnv === "production") res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
  },
}));
const rateLimitResponse = (_req, res) => res.status(429).json({ success: false, message: "Too many requests. Please wait a moment and try again.", data: {}, code: "RATE_LIMITED" });
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: env.apiRateLimit, skip: (req) => ["/api/health", "/api/messages", "/api/calls"].some((path) => req.originalUrl.startsWith(path)), standardHeaders: true, legacyHeaders: false, handler: rateLimitResponse, passOnStoreError: true }));
app.use(["/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/forgot-password", "/api/auth/reset-password"], rateLimit({ windowMs: 15 * 60 * 1000, limit: env.authRateLimit, standardHeaders: true, legacyHeaders: false, handler: rateLimitResponse, passOnStoreError: true }));

app.use("/api", routes);
app.use("/api/identity", manualBankRoutes);
app.use("/api/identity", identityRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

