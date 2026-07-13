import mongoose from "mongoose";
import Content from "../models/Content.js";
import Subscription from "../models/Subscription.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getAdminDashboard = asyncHandler(async (_req, res) => {
  const [totalUsers, fans, creators, admins, activeUsers, publishedContent, draftContent, activeSubscriptions] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "fan" }),
      User.countDocuments({ role: "creator" }),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ status: "active" }),
      Content.countDocuments({ status: "published" }),
      Content.countDocuments({ status: "draft" }),
      Subscription.countDocuments({ status: "active" }),
    ]);

  return sendResponse(res, 200, "Admin dashboard fetched", {
    stats: { totalUsers, fans, creators, admins, activeUsers, publishedContent, draftContent, activeSubscriptions },
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (["fan", "creator", "admin"].includes(req.query.role)) filter.role = req.query.role;
  if (["active", "suspended"].includes(req.query.status)) filter.status = req.query.status;

  const users = await User.find(filter)
    .select("name username email role status isVerified avatar createdAt")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return sendResponse(res, 200, "Users fetched", { users });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new ApiError(400, "Invalid user ID");
  if (!["active", "suspended"].includes(req.body.status)) {
    throw new ApiError(400, "Status must be active or suspended");
  }
  if (req.params.userId === req.user._id.toString()) {
    throw new ApiError(400, "You cannot change your own account status");
  }

  const user = await User.findByIdAndUpdate(
    req.params.userId,
    { $set: { status: req.body.status } },
    { new: true, runValidators: true }
  ).select("name username email role status isVerified avatar createdAt");
  if (!user) throw new ApiError(404, "User not found");

  return sendResponse(res, 200, "User status updated", { user });
});

export const listContentForModeration = asyncHandler(async (_req, res) => {
  const items = await Content.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .populate("creator", "name username avatar")
    .lean();
  return sendResponse(res, 200, "Content moderation list fetched", { items });
});

export const updateContentStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.contentId)) throw new ApiError(400, "Invalid content ID");
  if (!["draft", "published"].includes(req.body.status)) {
    throw new ApiError(400, "Status must be draft or published");
  }

  const update = {
    status: req.body.status,
    publishedAt: req.body.status === "published" ? new Date() : null,
  };
  const content = await Content.findByIdAndUpdate(req.params.contentId, { $set: update }, { new: true })
    .populate("creator", "name username avatar");
  if (!content) throw new ApiError(404, "Content not found");

  return sendResponse(res, 200, "Content status updated", { content });
});
