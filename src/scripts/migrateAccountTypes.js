import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import User from "../models/User.js";

const apply = process.argv.includes("--apply");

async function main() {
  await connectDb();
  try {
    const missingFilter = { $or: [{ accountType: { $exists: false } }, { accountType: null }] };
    const missing = await User.countDocuments(missingFilter);
    const existing = await User.aggregate([{ $group: { _id: { $ifNull: ["$accountType", "MISSING"] }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
    const report = { dryRun: !apply, defaultAccountType: "SEED", missing, existing };
    if (apply && missing) report.result = await User.updateMany(missingFilter, { $set: { accountType: "SEED" } }, { runValidators: true });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
