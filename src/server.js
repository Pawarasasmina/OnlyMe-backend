import app from "./app.js";
import http from "node:http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { connectDb } from "./config/db.js";
import { env, validateProductionEnv } from "./config/env.js";
import { retryPendingVerificationFileCleanup } from "./services/verificationFileCleanupService.js";
import { processDuePremiumMemberships } from "./services/premiumMembershipService.js";
import { configureMessagingSocket } from "./realtime/messagingSocket.js";
import { processDueDirectAccessWindows } from "./services/directAccessService.js";
import { processDuePaidCalls } from "./services/paidCallService.js";
import { reconcileVerifiedCreatorBadges } from "./services/verifiedCreatorService.js";
import { processDueAccountDeletions } from "./services/accountDeletionService.js";
import { processExpiredBonusGrants } from "./services/bonusService.js";
import { processAutomaticPayouts } from "./services/payoutService.js";

const WORKER_INTERVAL_MS = 60 * 1000;
const INITIAL_WORKER_DELAY_MS = 5 * 1000;

let shuttingDown = false;
const workerTimers = new Set();

function scheduleWorker(run, delay) {
  const timer = setTimeout(() => {
    workerTimers.delete(timer);
    void run();
  }, delay);
  workerTimers.add(timer);
  timer.unref();
}

function startWorker(name, task) {
  const run = async () => {
    if (shuttingDown) return;
    try {
      await task();
    } catch (error) {
      console.error(`${name} worker failed`, error);
    } finally {
      if (!shuttingDown) scheduleWorker(run, WORKER_INTERVAL_MS);
    }
  };
  scheduleWorker(run, INITIAL_WORKER_DELAY_MS);
}

function startMaintenanceWorkers(io) {
  startWorker("Verification file cleanup", retryPendingVerificationFileCleanup);
  startWorker("Premium renewal", () => processDuePremiumMemberships(new Date(), io));
  startWorker("Direct Access expiry", () => processDueDirectAccessWindows(new Date(), io));
  startWorker("Paid call refund", () => processDuePaidCalls(new Date(), io));
  startWorker("Verified Creator renewal", reconcileVerifiedCreatorBadges);
  startWorker("Account deletion", processDueAccountDeletions);
  startWorker("Bonus expiry", processExpiredBonusGrants);
  startWorker("Automatic payout", processAutomaticPayouts);
}

async function startServer() {
  try {
    validateProductionEnv();
    await connectDb();
    const server = http.createServer(app);
    server.requestTimeout = env.requestTimeoutMs;
    server.headersTimeout = env.headersTimeoutMs;
    server.keepAliveTimeout = env.keepAliveTimeoutMs;
    const io = new Server(server, { cors: { origin: env.clientUrl, credentials: true } });
    configureMessagingSocket(io);
    app.set("io", io);
    server.listen(env.port, () => {
      console.log(`OnlyMe API listening on port ${env.port}`);
      // Maintenance must never delay API readiness or cold-start recovery.
      if (env.maintenanceWorkersEnabled) startMaintenanceWorkers(io);
      else console.log("Maintenance workers disabled for this API instance");
    });

    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.set("shuttingDown", true);
      console.log(`${signal} received; draining connections`);
      workerTimers.forEach(clearTimeout);
      workerTimers.clear();

      const forceTimer = setTimeout(() => {
        console.error("Graceful shutdown timed out");
        process.exit(1);
      }, env.shutdownTimeoutMs);
      forceTimer.unref();

      io.disconnectSockets(true);
      server.close(async (error) => {
        try {
          io.close();
          await mongoose.disconnect();
          clearTimeout(forceTimer);
          process.exit(error ? 1 : 0);
        } catch (shutdownError) {
          console.error("Graceful shutdown failed", shutdownError);
          process.exit(1);
        }
      });
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();

