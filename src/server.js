import app from "./app.js";
import http from "node:http";
import { Server } from "socket.io";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { retryPendingVerificationFileCleanup } from "./services/verificationFileCleanupService.js";
import { processDuePremiumMemberships } from "./services/premiumMembershipService.js";
import { configureMessagingSocket } from "./realtime/messagingSocket.js";

async function startServer() {
  try {
    await connectDb();
    await retryPendingVerificationFileCleanup();
    await processDuePremiumMemberships();
    const premiumRenewalTimer = setInterval(
      () => processDuePremiumMemberships().catch((error) =>
        console.error("Premium renewal worker failed", error),
      ),
      60 * 1000,
    );
    premiumRenewalTimer.unref();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: env.clientUrl, credentials: true } });
    configureMessagingSocket(io);
    app.set("io", io);
    server.listen(env.port, () => {
      console.log(`OnlyMe API listening on port ${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();

