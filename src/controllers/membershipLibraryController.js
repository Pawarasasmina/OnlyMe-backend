import { getMembershipRecap, publishedChapterEvents, recordMembershipContentEvents } from "../services/membershipRecapService.js";
import mongoose from "mongoose";
import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import Story from "../models/Story.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import ApiError from "../utils/ApiError.js";

// Previews contain published content only and require an unexpired membership.
export const getMembershipLibrary = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, "Membership not found");
  const membership = await PremiumMembership.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!membership) throw new ApiError(404, "Membership not found");
  if (!["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(membership.status) || membership.currentPeriodEnd <= new Date()) throw new ApiError(403, "Membership is no longer active");
  const [world, stories] = await Promise.all([
    Publication.findOne({ _id: membership.premiumPublication, status: "PUBLISHED" }).select("creator status publishedAt publishedSnapshot coverMedia includedExperienceIds").lean(),
    Story.find({ creator: membership.creator, audience: "world" }).select("caption createdAt expiresAt").sort({ createdAt: -1 }).lean(),
  ]);
  const now = new Date();
  const included = world?.includedExperienceIds?.length ? await Publication.find({ _id: { $in: world.includedExperienceIds }, creator: membership.creator, status: "PUBLISHED" }).select("creator status publishedAt publishedSnapshot").lean() : [];
  const publications = [world, ...included].filter(Boolean);
  await recordMembershipContentEvents([
    ...stories.map(story => ({ key: `story:${story._id}`, kind: "STORY", creator: membership.creator, occurredAt: story.createdAt })),
    ...publications.flatMap(publishedChapterEvents),
  ]);
  const recap = await getMembershipRecap(membership, publications.map(publication => publication._id), now);
  const liveStories = stories.filter(story => new Date(story.expiresAt) > now);
  const chapters = (world?.publishedSnapshot?.chapters || []).filter(ch => ch.releaseMode !== "SCHEDULED" || (ch.releaseAt && new Date(ch.releaseAt) <= new Date()));
  const items = [
    ...liveStories.slice(0, 3).map(story => ({ id: String(story._id), kind: "story", title: story.caption || "Private story", image: "" })),
    ...chapters.slice(-2).map((ch, i) => ({ id: ch.stableChapterId || `chapter-${i}`, kind: "chapter", title: ch.title || "Chapter", image: ch.blocks?.find(block => block.media?.mediaType === "IMAGE")?.media?.secureUrl || world?.coverMedia?.secureUrl || "" })),
  ];
  return sendResponse(res, 200, "Membership library fetched", {
    recap,
    available: { stories: liveStories.length, chapters: chapters.length },
    items,
  });
});
