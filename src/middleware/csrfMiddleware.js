import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigin(origin) {
  if (!origin) return false;
  if (origin === env.clientUrl) return true;
  if (env.nodeEnv === "production") return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.headers.authorization || (!req.cookies?.accessToken && !req.cookies?.refreshToken)) return next();
  if (!allowedOrigin(req.get("Origin")) || req.get("X-Requested-With") !== "XMLHttpRequest") {
    return next(new ApiError(403, "Request origin could not be verified", "CSRF_CHECK_FAILED"));
  }
  return next();
}
