import app from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { retryPendingVerificationFileCleanup } from "./services/verificationFileCleanupService.js";
import { processDuePremiumMemberships } from "./services/premiumMembershipService.js";

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
    app.listen(env.port, () => {
      console.log(`OnlyMe API listening on port ${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();

