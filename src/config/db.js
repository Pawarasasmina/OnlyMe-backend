import mongoose from "mongoose";
import { env } from "./env.js";

let listenersAttached = false;

function attachConnectionLogging() {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on("connected", () => console.log("MongoDB connected"));
  mongoose.connection.on("disconnected", () => console.error("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => console.log("MongoDB reconnected"));
  mongoose.connection.on("error", (error) => console.error("MongoDB connection error", error));
}

export async function connectDb() {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required. Add it to OnlyMe-backend/.env or src/controllers/.env.");
  }

  attachConnectionLogging();
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 45000, maxPoolSize: 20, minPoolSize: 1 });
}
