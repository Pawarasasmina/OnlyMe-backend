import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDb() {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required. Add it to OnlyMe-backend/.env or src/controllers/.env.");
  }

  await mongoose.connect(env.mongoUri);
}
