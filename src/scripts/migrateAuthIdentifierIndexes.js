import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import User from "../models/User.js";

const apply = process.argv.includes("--apply");

try {
  await connectDb();
  const indexes = await User.collection.indexes();
  const emailIndex = indexes.find(index => index.key?.email === 1 && Object.keys(index.key).length === 1);
  const duplicatePhones = await User.aggregate([
    { $match: { phone: { $type: "string", $ne: "" } } },
    { $group: { _id: "$phone", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]);
  const report = {
    apply,
    currentEmailIndex: emailIndex || null,
    emailIndexNeedsMigration: !emailIndex?.unique || !emailIndex?.partialFilterExpression,
    duplicatePhones,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply || !report.emailIndexNeedsMigration) process.exitCode = 0;
  else {
    if (emailIndex) await User.collection.dropIndex(emailIndex.name);
    await User.collection.createIndex(
      { email: 1 },
      { name: "email_1", unique: true, partialFilterExpression: { email: { $type: "string" } } },
    );
    console.log("Email index now supports accounts registered with phone only.");
  }
} finally {
  await mongoose.disconnect();
}
