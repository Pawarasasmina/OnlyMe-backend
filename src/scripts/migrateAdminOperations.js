import mongoose from "mongoose";
import { env } from "../config/env.js";
import User from "../models/User.js";
import MessageReport from "../models/MessageReport.js";
import PublicationReport from "../models/PublicationReport.js";
import PlatformSetting from "../models/PlatformSetting.js";
const apply = process.argv.includes("--apply");
const urgent = ["CHILD_SAFETY", "SELF_HARM", "DEFAMATION"];
await mongoose.connect(env.mongoUri);
const setting = await PlatformSetting.findOne({ key: "moderation-policy" }).lean(); const urgentHours = Number(setting?.value?.urgentHours) || 4; const standardHours = Number(setting?.value?.standardHours) || 24;
const admins = await User.countDocuments({ role: "admin", $or: [{ adminRole: { $exists: false } }, { adminRole: null }] });
const messageRows = await MessageReport.find({ $or: [{ dueAt: null }, { priority: { $exists: false } }] }).select("reason createdAt").lean();
const publicationRows = await PublicationReport.find({ $or: [{ dueAt: null }, { priority: { $exists: false } }] }).select("reason createdAt").lean();
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", legacyAdmins: admins, messageReports: messageRows.length, publicationReports: publicationRows.length }, null, 2));
if (apply) { await User.updateMany({ role: "admin", $or: [{ adminRole: { $exists: false } }, { adminRole: null }] }, { $set: { adminRole: "MAIN_ADMIN", adminTwoFactorEnabled: false } }); for (const [Model, rows] of [[MessageReport, messageRows], [PublicationReport, publicationRows]]) for (const row of rows) { const isUrgent = urgent.includes(row.reason); await Model.updateOne({ _id: row._id }, { $set: { priority: isUrgent ? "URGENT" : "STANDARD", priorityRank: isUrgent ? 2 : 1, dueAt: new Date(new Date(row.createdAt).getTime() + (isUrgent ? urgentHours : standardHours) * 3600000), source: "USER_REPORT" } }); } }
await mongoose.disconnect();
