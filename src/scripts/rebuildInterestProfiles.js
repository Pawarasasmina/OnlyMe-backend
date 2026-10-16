import { connectDb } from "../config/db.js";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import UserInterestProfile from "../models/UserInterestProfile.js";
import { updateInterestProfileFromEvent } from "../services/interestProfileService.js";

const apply = process.argv.includes("--apply");

async function run() {
  await connectDb();
  const userIds = await AnalyticsEvent.distinct("userId", { eventType: { $in: ["FOLLOW", "SAVE", "SHARE", "CONTENT_REPLAY", "CONTENT_COMPLETED", "REACTION", "PROFILE_VIEW", "CONTENT_WATCH", "FAST_SKIP", "NOT_INTERESTED", "HIDE"] } });
  if (!apply) {
    console.log(`Dry run: ${userIds.length} user interest profiles would be rebuilt. Run with --apply to write changes.`);
    return;
  }
  let rebuilt = 0;
  for (const userId of userIds) {
    await UserInterestProfile.deleteOne({ user: userId });
    const events = await AnalyticsEvent.find({ userId }).sort({ createdAt: 1 }).lean();
    for (const event of events) await updateInterestProfileFromEvent({ eventType: event.eventType, metadata: event.metadata, now: event.createdAt, userId });
    await UserInterestProfile.updateOne({ user: userId }, { $set: { rebuiltAt: new Date() } });
    rebuilt += 1;
  }
  console.log(`Rebuilt ${rebuilt} user interest profiles.`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const mongoose = await import("mongoose");
  await mongoose.default.connection.close();
});
