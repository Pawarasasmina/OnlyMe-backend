import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import WorldEntitlement from "../models/WorldEntitlement.js";

const ACTIVE_MEMBERSHIP_STATUSES = ["ACTIVE", "CANCEL_AT_PERIOD_END"];

export function worldIncludedExperienceIds(world) {
  const ids = world?.publishedSnapshot?.metadata?.includedExperienceIds || world?.includedExperienceIds || [];
  return new Set(ids.map(String));
}

export async function activeIncludedExperienceIds(userId, creatorId) {
  if (!userId || !creatorId) return new Set();
  const membership = await PremiumMembership.findOne({
    user: userId,
    creator: creatorId,
    status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
    currentPeriodEnd: { $gt: new Date() },
  }).select("premiumPublication").lean();
  if (!membership?.premiumPublication) return new Set();
  const world = await Publication.findOne({
    _id: membership.premiumPublication,
    creator: creatorId,
    kind: "PREMIUM_WORLD",
    status: { $in: ["PUBLISHED", "CHANGES_REQUESTED"] },
    publishedSnapshot: { $exists: true },
  }).select("includedExperienceIds publishedSnapshot.metadata.includedExperienceIds").lean();
  return worldIncludedExperienceIds(world);
}

export async function publicationEntitlement(publication, viewer) {
  if (!viewer?._id) return null;
  const creator = publication.creator?._id || publication.creator;
  if (viewer.role === "admin" || String(viewer._id) === String(creator)) return null;

  if (["WORLD", "EXPERIENCE"].includes(publication.kind)) {
    if (await WorldEntitlement.exists({ user: viewer._id, publication: publication._id, status: "ACTIVE" })) {
      return publication.kind === "EXPERIENCE" ? "ENTITLED_EXPERIENCE" : "ENTITLED_WORLD";
    }
    if (publication.kind === "EXPERIENCE") {
      const includedIds = await activeIncludedExperienceIds(viewer._id, creator);
      if (includedIds.has(String(publication._id))) return "ACTIVE_PREMIUM_MEMBER";
    }
    return null;
  }

  if (publication.kind === "PREMIUM_WORLD") {
    return await PremiumMembership.exists({
      user: viewer._id,
      premiumPublication: publication._id,
      status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
      currentPeriodEnd: { $gt: new Date() },
    }) ? "ACTIVE_PREMIUM_MEMBER" : null;
  }
  return null;
}
