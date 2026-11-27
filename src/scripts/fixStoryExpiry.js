// B19: finds stories from REAL/SEED accounts whose expiry is later than 24h after creation
// (e.g. the old year-9999 bug) and corrects them. TEST accounts keep permanent stories.
// Stories under an active legal hold are never touched. Highlights keep their own copy, so they are unaffected.
//   npm run stories:fix-expiry:dry-run   → report only, changes nothing
//   npm run stories:fix-expiry           → apply
// Already-overdue stories get a 1-hour grace period instead of disappearing instantly
// (MongoDB deletes a story automatically once expiresAt has passed).
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import Story from "../models/Story.js";
import User from "../models/User.js";
import LegalHold from "../models/LegalHold.js";
import { STORY_LIFETIME_MS } from "../services/storyExpiryService.js";

const apply = process.argv.includes("--apply");
const GRACE_MS = 60 * 60 * 1000;

async function main() {
  await connectDb();
  try {
    const now = new Date();
    const tooLong = await Story.find({ $expr: { $gt: ["$expiresAt", { $add: ["$createdAt", STORY_LIFETIME_MS + 60 * 1000] }] } })
      .select("creator createdAt expiresAt")
      .lean();

    const creatorIds = [...new Set(tooLong.map((story) => String(story.creator)))];
    const testCreators = new Set((await User.find({ _id: { $in: creatorIds }, accountType: "TEST" }).select("_id").lean()).map((user) => String(user._id)));
    const heldIds = new Set((await LegalHold.find({ targetType: "CONTENT", active: true, targetId: { $in: tooLong.map((story) => String(story._id)) } }).select("targetId").lean()).map((hold) => String(hold.targetId)));

    const toFix = tooLong.filter((story) => !testCreators.has(String(story.creator)) && !heldIds.has(String(story._id)));
    const plan = toFix.map((story) => {
      const correct = new Date(new Date(story.createdAt).getTime() + STORY_LIFETIME_MS);
      const next = correct > now ? correct : new Date(now.getTime() + GRACE_MS);
      return { id: String(story._id), creator: String(story.creator), created: story.createdAt, currentExpiry: story.expiresAt, newExpiry: next };
    });

    console.log(JSON.stringify({
      dryRun: !apply,
      storiesLongerThan24h: tooLong.length,
      skippedTestAccounts: tooLong.filter((story) => testCreators.has(String(story.creator))).length,
      skippedLegalHold: heldIds.size,
      toFix: plan.length,
      overdueGettingGracePeriod: plan.filter((row) => row.newExpiry.getTime() === now.getTime() + GRACE_MS).length,
    }, null, 2));
    if (plan.length) console.table(plan.slice(0, 50).map((row) => ({ ...row, created: row.created.toISOString(), currentExpiry: new Date(row.currentExpiry).toISOString(), newExpiry: row.newExpiry.toISOString() })));

    if (apply && plan.length) {
      const result = await Story.bulkWrite(plan.map((row) => ({ updateOne: { filter: { _id: row.id }, update: { $set: { expiresAt: row.newExpiry } } } })));
      console.log(`Updated ${result.modifiedCount} stories`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
