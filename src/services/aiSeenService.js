import crypto from "node:crypto";
import AiSeenUsage from "../models/AiSeenUsage.js";
import Publication from "../models/Publication.js";
import ApiError from "../utils/ApiError.js";

export const AI_SEEN_MAX_DAILY = 3;
export const AI_SEEN_MAX_TRIES = 3;

export const aiSeenDateKey = (date = new Date()) => date.toISOString().slice(0, 10);
export const aiSeenBaseLimit = (user, now = new Date()) => {
  const firstWeek = user?.createdAt && now.getTime() - new Date(user.createdAt).getTime() < 7 * 86_400_000;
  const seller = user?.creatorApprovalStatus === "approved" || ["creator", "business"].includes(String(user?.accountType || "").toLowerCase());
  return firstWeek || seller ? 3 : 1;
};
const resetAt = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
const allowance = (usage, baseLimit) => Math.min(AI_SEEN_MAX_DAILY, baseLimit + Number(usage?.publishedBonusCount || 0));
const statusPayload = (usage, baseLimit, now = new Date()) => ({
  baseLimit,
  dailyLimit: allowance(usage, baseLimit),
  used: Number(usage?.startedCount || 0),
  remaining: Math.max(0, allowance(usage, baseLimit) - Number(usage?.startedCount || 0)),
  resetAt: resetAt(now),
  maxTriesPerSeen: AI_SEEN_MAX_TRIES,
});

export async function getAiSeenStatus(user, now = new Date()) {
  const baseLimit = aiSeenBaseLimit(user, now);
  const usage = await AiSeenUsage.findOne({ user: user._id, dateKey: aiSeenDateKey(now) }).lean();
  return statusPayload(usage, baseLimit, now);
}

export async function startAiSeen(user, now = new Date()) {
  const dateKey = aiSeenDateKey(now);
  const baseLimit = aiSeenBaseLimit(user, now);
  const existing = await AiSeenUsage.findOne({ user: user._id, dateKey }).lean();
  const limit = allowance(existing, baseLimit);
  if (Number(existing?.startedCount || 0) >= limit) throw new ApiError(429, "Your AI Seen creations are saved for tomorrow", "AI_SEEN_DAILY_LIMIT");
  const sessionId = crypto.randomUUID();
  try {
    const usage = await AiSeenUsage.findOneAndUpdate(
      { user: user._id, dateKey, startedCount: { $lt: limit } },
      { $setOnInsert: { baseLimit }, $inc: { startedCount: 1 }, $push: { sessions: { sessionId, startedAt: now } } },
      { new: true, upsert: true, runValidators: true },
    ).lean();
    return { sessionId, ...statusPayload(usage, baseLimit, now) };
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(429, "Your AI Seen creations are saved for tomorrow", "AI_SEEN_DAILY_LIMIT");
    throw error;
  }
}

export async function useAiSeenTry(user, sessionId, answer, { sayAgain = false } = {}) {
  const cleanAnswer = String(answer || "").trim().slice(0, 4000);
  if (!cleanAnswer) throw new ApiError(400, "Answer the question before creating this chapter", "AI_SEEN_ANSWER_REQUIRED");
  const dateKey = aiSeenDateKey();
  const filter = { user: user._id, dateKey, sessions: { $elemMatch: { sessionId, attemptsUsed: { $lt: AI_SEEN_MAX_TRIES }, ...(sayAgain ? { answerRevisionsUsed: { $lt: 1 } } : {}) } } };
  const update = { $inc: { "sessions.$.attemptsUsed": 1, ...(sayAgain ? { "sessions.$.answerRevisionsUsed": 1 } : {}) } };
  const usage = await AiSeenUsage.findOneAndUpdate(filter, update, { new: true }).lean();
  if (!usage) throw new ApiError(409, sayAgain ? "You already used Say it again for this answer" : "No AI tries remain for this Seen", "AI_SEEN_TRIES_EXHAUSTED");
  const session = usage.sessions.find((item) => item.sessionId === sessionId);
  const firstSentence = cleanAnswer.split(/[.!?\n]/u).map((part) => part.trim()).find(Boolean) || cleanAnswer;
  const heading = firstSentence.slice(0, 72);
  return {
    heading,
    caption: firstSentence.slice(0, 140),
    text: cleanAnswer,
    attemptsRemaining: Math.max(0, AI_SEEN_MAX_TRIES - Number(session?.attemptsUsed || 0)),
    lastTry: Number(session?.attemptsUsed || 0) === AI_SEEN_MAX_TRIES - 1,
  };
}

export async function linkAiSeenPublication(user, sessionId, publicationId) {
  const publication = await Publication.findOne({ _id: publicationId, creator: user._id, kind: "SEEN", status: { $in: ["DRAFT", "CHANGES_REQUESTED"] } });
  if (!publication) throw new ApiError(404, "Editable Seen not found");
  const usage = await AiSeenUsage.findOneAndUpdate(
    { user: user._id, "sessions.sessionId": sessionId },
    { $set: { "sessions.$.publication": publication._id } },
    { new: true },
  );
  if (!usage) throw new ApiError(404, "AI Seen session not found");
  publication.aiAssistance = { sessionId, generated: true };
  await publication.save();
  return publication;
}

export async function grantAiSeenPublishBonus(userId, publicationId, now = new Date()) {
  const usage = await AiSeenUsage.findOneAndUpdate(
    { user: userId, dateKey: aiSeenDateKey(now), "sessions.publication": publicationId, bonusPublicationIds: { $ne: publicationId } },
    { $addToSet: { bonusPublicationIds: publicationId }, $inc: { publishedBonusCount: 1 }, $set: { "sessions.$[session].completedAt": now } },
    { new: true, arrayFilters: [{ "session.publication": publicationId }] },
  ).lean();
  return usage ? statusPayload(usage, usage.baseLimit, now) : null;
}
