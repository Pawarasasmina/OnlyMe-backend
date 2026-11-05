import mongoose from "mongoose";
import Publication from "../models/Publication.js";
import FeedPost from "../models/FeedPost.js";
import Story from "../models/Story.js";
import MessageReport from "../models/MessageReport.js";
import PublicationReport from "../models/PublicationReport.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import LegalHold from "../models/LegalHold.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import AdminLoginEvent from "../models/AdminLoginEvent.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";
export const exportContentHistory = asyncHandler(async (req, res) => { if (!mongoose.isValidObjectId(req.query.id)) throw new ApiError(400, "Invalid content ID"); const id = req.query.id; const [publication, post, story] = await Promise.all([Publication.findById(id).select("+submittedSnapshot +publishedSnapshot +internalModerationNote").lean(), FeedPost.findById(id).lean(), Story.findById(id).lean()]); const content = publication || post || story; if (!content) throw new ApiError(404, "Content not found"); const [messageReports, publicationReports, actions, holds] = await Promise.all([MessageReport.find({ $or: [{ publication: id }, { feedPost: id }, { story: id }] }).select("+snapshot").sort({ createdAt: 1 }).lean(), PublicationReport.find({ publication: id }).sort({ createdAt: 1 }).lean(), AdminAuditEvent.find({ $or: [{ targetType: "CONTENT", targetId: String(id) }, { "metadata.contentId": String(id) }] }).sort({ createdAt: 1 }).lean(), LegalHold.find({ targetType: "CONTENT", targetId: String(id) }).sort({ createdAt: 1 }).lean()]); const payload = { exportedAt: new Date(), type: "CONTENT", contentType: publication ? "PUBLICATION" : post ? "POST" : "STORY", content, reports: [...messageReports, ...publicationReports], actions, holds }; await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action: "DATA_EXPORTED", targetType: "CONTENT", targetId: String(id), reason: String(req.query.reason || "Administrative content history export").trim().slice(0, 2000) }); return sendResponse(res, 200, "Content history export generated", { export: payload }); });

export const exportUserPackage = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.id)) throw new ApiError(400, "Select a valid user");
  const id = req.query.id; const section = String(req.query.section || "COMPLETE").toUpperCase();
  if (!["COMPLETE", "ACCOUNT", "MODERATION", "FINANCE", "CONTENT"].includes(section)) throw new ApiError(400, "Select a valid export section");
  const user = await User.findById(id).select("-password -resetPasswordToken -resetPasswordExpires").lean();
  if (!user) throw new ApiError(404, "User not found");
  const include = (name) => section === "COMPLETE" || section === name;
  const [logins, reports, actions, holds, wallet, ledger, publications, posts, stories] = await Promise.all([
    include("ACCOUNT") ? AdminLoginEvent.find({ user: id }).sort({ createdAt: 1 }).lean() : [],
    include("MODERATION") ? MessageReport.find({ $or: [{ reporter: id }, { reportedUser: id }] }).select("+snapshot").sort({ createdAt: 1 }).lean() : [],
    include("MODERATION") ? AdminAuditEvent.find({ targetType: "USER", targetId: String(id) }).sort({ createdAt: 1 }).lean() : [],
    include("ACCOUNT") || include("MODERATION") ? LegalHold.find({ targetType: "USER", targetId: String(id) }).sort({ createdAt: 1 }).lean() : [],
    include("FINANCE") ? Wallet.findOne({ user: id }).lean() : null,
    include("FINANCE") ? StarsLedgerEntry.find({ accountUser: id }).sort({ createdAt: 1 }).lean() : [],
    include("CONTENT") ? Publication.find({ creator: id }).select("+submittedSnapshot +publishedSnapshot").sort({ createdAt: 1 }).lean() : [],
    include("CONTENT") ? FeedPost.find({ author: id }).sort({ createdAt: 1 }).lean() : [],
    include("CONTENT") ? Story.find({ creator: id }).sort({ createdAt: 1 }).lean() : [],
  ]);
  const payload = { exportedAt: new Date(), type: "USER", section, user, ...(include("ACCOUNT") ? { loginHistory: logins, holds } : {}), ...(include("MODERATION") ? { reports, actions, holds } : {}), ...(include("FINANCE") ? { wallet, ledger } : {}), ...(include("CONTENT") ? { content: { publications, posts, stories } } : {}) };
  await AdminAuditEvent.create({ actor: req.user._id, actorRole: effectiveAdminRole(req.user), action: "DATA_EXPORTED", targetType: "USER", targetId: String(id), reason: String(req.query.reason || `Administrative ${section.toLowerCase()} export`).trim().slice(0, 2000), metadata: { section } });
  return sendResponse(res, 200, "User export generated", { export: payload });
});
