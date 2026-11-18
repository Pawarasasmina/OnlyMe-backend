import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import User from "../models/User.js";
import AdminProfile from "../models/AdminProfile.js";

const password = "12341234";
const accounts = [
  { name: "Main Admin Test", username: "admintest", email: "admintest@gmail.com", adminRole: "MAIN_ADMIN" },
  { name: "Moderator Test", username: "moderatortest", email: "moderatortest@gmail.com", adminRole: "MODERATOR" },
  { name: "Finance Test", username: "financetest", email: "financetest@gmail.com", adminRole: "FINANCE" },
];

await connectDb();
try {
  for (const account of accounts) {
    let user = await User.findOne({ email: account.email }).select("+password +accountType");
    if (!user) user = new User({ ...account, password });
    Object.assign(user, account, {
      password,
      role: "admin",
      status: "active",
      accountType: "TEST",
      adminReadOnly: true,
      adminTwoFactorEnabled: false,
      adminTwoFactorRequired: false,
      authVersion: Number(user.authVersion || 0) + 1,
    });
    await user.save();
    await AdminProfile.findOneAndUpdate(
      { user: user._id },
      { $set: { twoFactorSecret: "", twoFactorPendingSecret: "", twoFactorEnabledAt: null }, $setOnInsert: { user: user._id } },
      { upsert: true },
    );
    console.log(`${account.adminRole}: ${account.email}`);
  }
} finally {
  await mongoose.disconnect();
}
