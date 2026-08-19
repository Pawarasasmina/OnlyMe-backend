import express from "express";
import path from "node:path";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import routes from "./routes/index.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorMiddleware.js";
import { notFoundHandler } from "./middleware/notFoundMiddleware.js";
import { assertPrivateStorageConfiguration } from "./services/privateDocumentStorageService.js";

assertPrivateStorageConfiguration();


const app = express();
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
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/uploads", express.static(path.resolve("uploads")));
const rateLimitResponse = (_req, res) => res.status(429).json({ success: false, message: "Too many requests. Please wait a moment and try again.", data: {}, code: "RATE_LIMITED" });
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: env.apiRateLimit, skip: (req) => ["/api/health", "/api/messages", "/api/calls"].some((path) => req.originalUrl.startsWith(path)), standardHeaders: true, legacyHeaders: false, handler: rateLimitResponse, passOnStoreError: true }));
app.use(["/api/auth/login", "/api/auth/register", "/api/auth/refresh"], rateLimit({ windowMs: 15 * 60 * 1000, limit: env.authRateLimit, standardHeaders: true, legacyHeaders: false, handler: rateLimitResponse, passOnStoreError: true }));

app.use("/api", routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

