import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import User from "../models/User.js";
import CreatorProfile from "../models/CreatorProfile.js";
import Content from "../models/Content.js";
import Subscription from "../models/Subscription.js";
import Publication from "../models/Publication.js";
import PremiumMembership from "../models/PremiumMembership.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import ChatGift from "../models/ChatGift.js";
import DreamGift from "../models/DreamGift.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import ApiError from "../utils/ApiError.js";
import { buildCreatorDashboard } from "../services/creatorDashboardService.js";
import { buildGrowDashboard, resolveReferral } from "../services/referralService.js";
import { invitationLanding, joinInvitation } from "../services/invitationLandingService.js";
import { getStarExchangeRate } from "../services/starExchangeService.js";

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
  const users = await User.find({ role: { $in: ["fan", "creator"] }, status: "active", creatorApprovalStatus: "approved" })
    .select("name username avatar isVerified")
    .sort({ createdAt: -1 })
    .lean();
  const creators = await Promise.all(users.map(buildCreatorView));

  return sendResponse(res, 200, "Creators fetched", { creators });
});

export const getCreatorByUsername = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    username: req.params.username.toLowerCase(),
    role: { $in: ["fan", "creator"] },
    status: "active",
    creatorApprovalStatus: "approved",
  })
    .select("name username avatar isVerified")
    .lean();

  if (!user) throw new ApiError(404, "Creator not found");
  const creator = await buildCreatorView(user);
  return sendResponse(res, 200, "Creator fetched", { creator });
});

export const getCreatorDashboard = asyncHandler(async (req, res) => {
  const dashboard = await buildCreatorDashboard(req.user._id);
  return sendResponse(res, 200, "Creator dashboard fetched", dashboard);
});

export const getWaysToEarnDashboard = asyncHandler(async (req, res) => {
  const exampleUser = await User.findOne({
    _id: { $ne: req.user._id },
    role: { $in: ["fan", "creator"] },
    status: "active",
    creatorApprovalStatus: "approved",
  }).sort({ createdAt: 1 }).select("name username avatar").lean();
  const dashboard = await buildCreatorDashboard(req.user._id);
  let example = null;
  if (exampleUser) {
    const [publications, memberships, gifts, dreamGifts, starsPerUsd, followers] = await Promise.all([
      Publication.find({ creator: exampleUser._id, status: "PUBLISHED", "pricing.mode": { $in: ["ONE_TIME", "MONTHLY"] } }).select("title kind pricing").lean(),
      PremiumMembership.find({ creator: exampleUser._id, status: "ACTIVE" }).select("starsPerPeriod").lean(),
      ChatGift.find({ recipient: exampleUser._id, visibility: "EVERYONE", hiddenFromProfile: { $ne: true } }).select("starsAmount").lean(),
      DreamGift.find({ creator: exampleUser._id, privateSupport: false, hiddenFromProfile: { $ne: true } }).select("starsAmount").lean(),
      getStarExchangeRate(),
      ProfileRelationship.countDocuments({ target: exampleUser._id, type: "FOLLOW" }),
    ]);
    const paidSeens = publications.filter((item) => item.kind === "SEEN" && item.pricing?.mode === "ONE_TIME");
    const paidIds = paidSeens.map((item) => item._id);
    const owners = paidIds.length ? await WorldEntitlement.countDocuments({ publication: { $in: paidIds }, status: "ACTIVE" }) : 0;
    const paidStars = paidSeens.reduce((sum, item) => sum + Number(item.pricing?.starsAmount || 0), 0) * owners;
    const worldStars = memberships.reduce((sum, item) => sum + Number(item.starsPerPeriod || 0), 0);
    const giftRows = [...gifts, ...dreamGifts];
    const giftStars = giftRows.reduce((sum, item) => sum + Number(item.starsAmount || 0), 0);
    const toUsd = (stars) => Number((stars / Math.max(1, starsPerUsd)).toFixed(2));
    example = {
      avatar: exampleUser.avatar || "",
      followers,
      gifts: { count: giftRows.length, income: toUsd(giftStars) },
      name: exampleUser.name,
      paidSeen: { income: toUsd(paidStars), owners, title: paidSeens[0]?.title || "Paid Seen" },
      username: exampleUser.username,
      world: { income: toUsd(worldStars), members: memberships.length },
    };
  }
  return sendResponse(res, 200, "Ways to earn dashboard fetched", {
    dashboard,
    example,
  });
});

export const getGrowDashboard = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Grow dashboard fetched", await buildGrowDashboard(req.user));
});

export const getReferralInvitation = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Invitation fetched", await resolveReferral(req.params.code));
});

export const getInvitationLanding = asyncHandler(async (req, res) => sendResponse(res, 200, "Invitation fetched", await invitationLanding(req.params.code, req.user)));
export const acceptInvitation = asyncHandler(async (req, res) => sendResponse(res, 200, "Invitation joined", await joinInvitation(req.params.code, req.user)));
