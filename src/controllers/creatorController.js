import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import User from "../models/User.js";
import CreatorProfile from "../models/CreatorProfile.js";
import Content from "../models/Content.js";
import Subscription from "../models/Subscription.js";
import ApiError from "../utils/ApiError.js";

async function buildCreatorView(user) {
  const [profile, posts, members] = await Promise.all([
    CreatorProfile.findOne({ user: user._id }).lean(),
    Content.countDocuments({ creator: user._id, status: { $in: ["PUBLISHED", "published"] } }),
    Subscription.countDocuments({ creator: user._id, status: "active" }),
  ]);

  return {
    id: user._id,
    username: user.username,
    name: user.name,
    avatar: user.avatar,
    isVerified: user.isVerified,
    bio: profile?.bio || "",
    category: profile?.category || "Creator",
    monthlyPrice: profile?.monthlyPrice || 0,
    posts,
    members,
  };
}

export const listCreators = asyncHandler(async (_req, res) => {
  const users = await User.find({ role: "creator", status: "active", creatorApprovalStatus: "approved" })
    .select("name username avatar isVerified")
    .sort({ createdAt: -1 })
    .lean();
  const creators = await Promise.all(users.map(buildCreatorView));

  return sendResponse(res, 200, "Creators fetched", { creators });
});

export const getCreatorByUsername = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    username: req.params.username.toLowerCase(),
    role: "creator",
    status: "active",
    creatorApprovalStatus: "approved",
  })
    .select("name username avatar isVerified")
    .lean();

  if (!user) throw new ApiError(404, "Creator not found");
  const creator = await buildCreatorView(user);
  return sendResponse(res, 200, "Creator fetched", { creator });
});

export const getCreatorDashboard = asyncHandler(async (_req, res) => {
  return sendResponse(res, 200, "Creator dashboard placeholder", {
    metrics: [],
  });
});
