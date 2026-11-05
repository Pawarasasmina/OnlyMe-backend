import ProfileRelationship from "../models/ProfileRelationship.js";
import PremiumMembership from "../models/PremiumMembership.js";
import UserBlock from "../models/UserBlock.js";
import User from "../models/User.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import "../models/Publication.js";

// Resolve the same access rules for a whole feed in a fixed number of queries.
export async function storyAudiencesByCreator(creatorIds, viewerId) {
  const ids = [...new Set(creatorIds.map(String))];
  const result = new Map();
  if (!ids.length) return result;
  const [owners, blocks, relationships, memberships, entitlements] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("status").lean(),
    viewerId ? UserBlock.find({ $or: [{ blocker: viewerId, blocked: { $in: ids } }, { blocker: { $in: ids }, blocked: viewerId }] }).select("blocker blocked").lean() : [],
    viewerId ? ProfileRelationship.find({ type: "FOLLOW", $or: [{ actor: viewerId, target: { $in: ids } }, { actor: { $in: ids }, target: viewerId }] }).select("actor target").lean() : [],
    viewerId ? PremiumMembership.find({ user: viewerId, creator: { $in: ids }, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } }).select("creator").lean() : [],
    viewerId ? WorldEntitlement.find({ user: viewerId, creator: { $in: ids }, status: "ACTIVE" }).select("creator publication").populate({ path: "publication", match: { kind: "WORLD" }, select: "_id" }).lean() : [],
  ]);
  const statuses = new Map(owners.map(owner => [String(owner._id), owner.status]));
  const blocked = new Set(blocks.map(row => String(String(row.blocker) === String(viewerId) ? row.blocked : row.blocker)));
  const following = new Set(relationships.filter(row => String(row.actor) === String(viewerId)).map(row => String(row.target)));
  const followers = new Set(relationships.filter(row => String(row.target) === String(viewerId)).map(row => String(row.actor)));
  const members = new Set(memberships.map(row => String(row.creator)));
  const unlocked = new Set(entitlements.filter(row => row.publication).map(row => String(row.creator)));
  for (const id of ids) {
    const status = statuses.get(id);
    let allowed;
    if (["deactivated", "pending_deletion", "deleted"].includes(status)) {
      allowed = status === "deactivated" && members.has(id) ? ["world"] : [];
    } else if (!viewerId) allowed = ["everyone"];
    else if (id === String(viewerId)) allowed = ["everyone", "followers", "close_circle", "only_me", "world"];
    else if (blocked.has(id)) allowed = [];
    else allowed = ["everyone", ...(following.has(id) ? ["followers"] : []), ...(following.has(id) && followers.has(id) ? ["close_circle"] : []), ...(members.has(id) || unlocked.has(id) ? ["world"] : [])];
    result.set(id, new Set(allowed));
  }
  return result;
}

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
