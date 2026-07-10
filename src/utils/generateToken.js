import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function generateAccessToken(payload) {
  return jwt.sign(payload, env.accessSecret, { expiresIn: env.accessExpiresIn });
}

export function generateRefreshToken(payload) {
  return jwt.sign(payload, env.refreshSecret, { expiresIn: env.refreshExpiresIn });
}
