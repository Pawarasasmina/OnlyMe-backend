// B15: read-only report of non-admin accounts still classified SEED (or missing a type),
// so staff can review which ones are real public sign-ups. Changes nothing.
// Fix the real ones in Admin → Users → filter SEED → select → "REAL" (asks for a reason and is audited).
//   npm run report:account-types
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import User from "../models/User.js";

async function main() {
  await connectDb();
  try {
    const totals = await User.aggregate([
      { $match: { role: { $ne: "admin" } } },
      { $group: { _id: { $ifNull: ["$accountType", "MISSING"] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const seedAccounts = await User.find({ role: { $ne: "admin" }, $or: [{ accountType: "SEED" }, { accountType: { $exists: false } }, { accountType: null }] })
      .select("+accountType name username email phone googleId createdAt")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    console.log("Accounts by type (admins excluded):");
    console.table(totals.map((row) => ({ type: row._id, count: row.count })));
    console.log(`SEED / unclassified accounts (newest first, max 500): ${seedAccounts.length}`);
    console.table(seedAccounts.map((user) => ({
      id: String(user._id),
      username: user.username,
      email: user.email || user.phone || "",
      google: user.googleId ? "yes" : "",
      created: user.createdAt ? new Date(user.createdAt).toISOString().slice(0, 10) : "",
    })));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
