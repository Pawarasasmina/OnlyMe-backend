import app from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";

async function startServer() {
  try {
    await connectDb();
    app.listen(env.port, () => {
      console.log(`OnlyMe API listening on port ${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();
