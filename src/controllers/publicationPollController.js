import Publication from "../models/Publication.js";
import PremiumMembership from "../models/PremiumMembership.js";
import PublicationPollVote from "../models/PublicationPollVote.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

async function accessiblePoll(req) {
  const publication = await Publication.findOne({ _id: req.params.id, status: "PUBLISHED", publishedSnapshot: { $exists: true } }).lean();
  if (!publication) throw new ApiError(404, "Planet not found");
  const chapter = publication.publishedSnapshot.chapters.find((item) => String(item.stableChapterId) === String(req.params.chapterId));
  const block = chapter?.blocks?.find((item) => item.id === req.params.blockId && item.type === "POLL");
  if (!chapter || !block) throw new ApiError(404, "Poll not found");
  const owner = req.user?._id && String(req.user._id) === String(publication.creator);
  if (publication.kind === "PREMIUM_WORLD" && !chapter.isPreview && !owner) {
    const membership = req.user?._id && await PremiumMembership.exists({ user: req.user._id, premiumPublication: publication._id, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } });
    if (!membership) throw new ApiError(403, "Join this Planet to vote in this poll");
  }
  return { publication, chapter, block, owner: Boolean(owner) };
}

async function pollPayload(req, source) {
  const viewerVote = req.user?._id ? await PublicationPollVote.findOne({ publication: source.publication._id, chapterId: String(source.chapter.stableChapterId), blockId: source.block.id, user: req.user._id }).select("optionIndex").lean() : null;
  const resultsVisible = source.block.metadata.resultsVisibility !== "CREATOR" || source.owner;
  if (!resultsVisible) return { counts: null, totalVotes: null, viewerChoice: viewerVote?.optionIndex ?? null, resultsVisible: false };
  const rows = await PublicationPollVote.aggregate([{ $match: { publication: source.publication._id, chapterId: String(source.chapter.stableChapterId), blockId: source.block.id } }, { $group: { _id: "$optionIndex", count: { $sum: 1 } } }]);
  const counts = source.block.metadata.options.map((_, index) => rows.find((row) => row._id === index)?.count || 0);
  return { counts, totalVotes: counts.reduce((sum, count) => sum + count, 0), viewerChoice: viewerVote?.optionIndex ?? null, resultsVisible: true };
}

export const getPublicationPoll = asyncHandler(async (req, res) => {
  const source = await accessiblePoll(req);
  return sendResponse(res, 200, "Poll fetched", await pollPayload(req, source));
});

export const votePublicationPoll = asyncHandler(async (req, res) => {
  const source = await accessiblePoll(req);
  const optionIndex = Number(req.body.optionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= source.block.metadata.options.length) throw new ApiError(400, "Choose a valid poll option");
  await PublicationPollVote.findOneAndUpdate({ publication: source.publication._id, chapterId: String(source.chapter.stableChapterId), blockId: source.block.id, user: req.user._id }, { $set: { optionIndex } }, { upsert: true, new: true });
  return sendResponse(res, 200, "Vote saved", await pollPayload(req, source));
});
