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

async function startServer() {
  try {
    await connectDb();
    await retryPendingVerificationFileCleanup();
    await processDuePremiumMemberships();
    await processDueDirectAccessWindows();
    await processDuePaidCalls();
    await reconcileVerifiedCreatorBadges();
    const premiumRenewalTimer = setInterval(
      () => processDuePremiumMemberships().catch((error) =>
        console.error("Premium renewal worker failed", error),
      ),
      60 * 1000,
    );
    premiumRenewalTimer.unref();
    const directAccessExpiryTimer = setInterval(
      () => processDueDirectAccessWindows(new Date(), io).catch((error) =>
        console.error("Direct Access expiry worker failed", error),
      ),
      60 * 1000,
    );
    directAccessExpiryTimer.unref();
    const paidCallExpiryTimer = setInterval(
      () => processDuePaidCalls(new Date(), io).catch((error) => console.error("Paid call refund worker failed", error)),
      60 * 1000,
    );
    paidCallExpiryTimer.unref();
    const verifiedCreatorRenewalTimer = setInterval(
      () => reconcileVerifiedCreatorBadges().catch((error) => console.error("Verified Creator renewal worker failed", error)),
      60 * 1000,
    );
    verifiedCreatorRenewalTimer.unref();
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

