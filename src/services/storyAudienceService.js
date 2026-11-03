import ProfileRelationship from "../models/ProfileRelationship.js";
import PremiumMembership from "../models/PremiumMembership.js";
import UserBlock from "../models/UserBlock.js";
import User from "../models/User.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import "../models/Publication.js";

export async function storyAudiencesFor(creatorId, viewerId) {
  const owner = await User.findById(creatorId).select("status").lean();
  if (owner && ["deactivated", "pending_deletion", "deleted"].includes(owner.status)) {
    const member = owner.status === "deactivated" && viewerId && await PremiumMembership.exists({ user: viewerId, creator: creatorId, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } });
    return new Set(member ? ["world"] : []);
  }
  if (!viewerId) return new Set(["everyone"]);
  if (String(creatorId) === String(viewerId)) return new Set(["everyone", "followers", "close_circle", "only_me", "world"]);
  const blocked = await UserBlock.exists({ $or: [{ blocker: viewerId, blocked: creatorId }, { blocker: creatorId, blocked: viewerId }] });
  if (blocked) return new Set();
  const [follows, followsBack, member, unlocked] = await Promise.all([
    ProfileRelationship.exists({ actor: viewerId, target: creatorId, type: "FOLLOW" }),
    ProfileRelationship.exists({ actor: creatorId, target: viewerId, type: "FOLLOW" }),
    PremiumMembership.exists({ user: viewerId, creator: creatorId, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } }),
    WorldEntitlement.find({ user: viewerId, creator: creatorId, status: "ACTIVE" }).select("publication").populate({ path: "publication", match: { kind: "WORLD" }, select: "_id" }).lean(),
  ]);
  return new Set(["everyone", ...(follows ? ["followers"] : []), ...(follows && followsBack ? ["close_circle"] : []), ...(member || unlocked.some((item) => item.publication) ? ["world"] : [])]);
}
