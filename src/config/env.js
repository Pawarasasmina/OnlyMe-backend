import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onlyme_dev",
  accessSecret: process.env.JWT_ACCESS_SECRET || "replace_with_secure_access_secret",
  refreshSecret: process.env.JWT_REFRESH_SECRET || "replace_with_secure_refresh_secret",
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
};
