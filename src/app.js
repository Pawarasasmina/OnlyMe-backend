import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import routes from "./routes/index.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorMiddleware.js";
import { notFoundHandler } from "./middleware/notFoundMiddleware.js";

const app = express();
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
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use("/api", routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
