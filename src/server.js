import app from "./app.js";
import http from "node:http";
import { Server } from "socket.io";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { retryPendingVerificationFileCleanup } from "./services/verificationFileCleanupService.js";
import { processDuePremiumMemberships } from "./services/premiumMembershipService.js";
import { configureMessagingSocket } from "./realtime/messagingSocket.js";
import { processDueDirectAccessWindows } from "./services/directAccessService.js";
import { processDuePaidCalls } from "./services/paidCallService.js";
import { reconcileVerifiedCreatorBadges } from "./services/verifiedCreatorService.js";

const WORKER_INTERVAL_MS = 60 * 1000;
const INITIAL_WORKER_DELAY_MS = 5 * 1000;

function startWorker(name, task) {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`${name} worker failed`, error);
    } finally {
      const timer = setTimeout(run, WORKER_INTERVAL_MS);
      timer.unref();
    }
  };

  const timer = setTimeout(run, INITIAL_WORKER_DELAY_MS);
  timer.unref();
}

async function startServer() {
  try {
    await connectDb();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: env.clientUrl, credentials: true } });
    configureMessagingSocket(io);
    app.set("io", io);
    server.listen(env.port, () => {
      console.log(`OnlyMe API listening on port ${env.port}`);
      // Maintenance must never delay API readiness or cold-start recovery.
      startWorker("Verification file cleanup", retryPendingVerificationFileCleanup);
      startWorker("Premium renewal", processDuePremiumMemberships);
      startWorker("Direct Access expiry", () => processDueDirectAccessWindows(new Date(), io));
      startWorker("Paid call refund", () => processDuePaidCalls(new Date(), io));
      startWorker("Verified Creator renewal", reconcileVerifiedCreatorBadges);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();

