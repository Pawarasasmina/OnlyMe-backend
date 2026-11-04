import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import User from "../models/User.js";
import MemberSequence from "../models/MemberSequence.js";
import { nextMemberNumber } from "../services/memberTicketService.js";

const apply = process.argv.includes("--apply");
try {
  await connectDb();
  const filter = { memberNumber: { $exists: false } };
  const missing = await User.countDocuments(filter);
  console.log(JSON.stringify({ dryRun: !apply, missing }));
  if (apply) {
    const highest = await User.findOne({ memberNumber: { $gt: 0 } }).sort({ memberNumber: -1 }).select("memberNumber").lean();
    await MemberSequence.updateOne({ _id: "members" }, { $max: { value: highest?.memberNumber || 0 } }, { upsert: true });
    // Existing accounts retain their join order; never change an assigned number.
    let assigned = 0;
    for await (const user of User.find(filter).sort({ createdAt: 1, _id: 1 }).select("_id").lean().cursor()) {
      const memberNumber = await nextMemberNumber();
      const result = await User.collection.updateOne({ _id: user._id, memberNumber: { $exists: false } }, { $set: { memberNumber } });
      assigned += result.modifiedCount;
    }
    await User.collection.createIndex({ memberNumber: 1 }, { unique: true, sparse: true });
    console.log(JSON.stringify({ assigned }));
  }
} catch (error) {
  console.error("Member ticket migration failed:", error.name);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
