import MembershipContentEvent from "../models/MembershipContentEvent.js";
import GroupConversation from "../models/GroupConversation.js";
import GroupMessage from "../models/GroupMessage.js";

export function publishedChapterEvents(publication) {
  if (publication?.status !== "PUBLISHED" || !publication.publishedSnapshot) return [];
  const publishedAt = publication.publishedAt || publication.publishedSnapshot.frozenAt;
  if (!publishedAt) return [];
  return (publication.publishedSnapshot.chapters || []).filter(ch => ch.stableChapterId).map(ch => ({
    key: `chapter:${publication._id}:${ch.stableChapterId}`,
    kind: "CHAPTER", creator: publication.creator?._id || publication.creator,
    publication: publication._id,
    occurredAt: new Date(Math.max(new Date(publishedAt).getTime(), ch.releaseMode === "SCHEDULED" && ch.releaseAt ? new Date(ch.releaseAt).getTime() : 0)),
  }));
}

export async function recordMembershipContentEvents(events, session = null) {
  if (!events.length) return;
  await MembershipContentEvent.bulkWrite(events.map(event => ({ updateOne: { filter: { key: event.key }, update: { $setOnInsert: event }, upsert: true } })), { ordered: false, ...(session ? { session } : {}) });
}

export async function recordWorldStory(story) {
  if (story.audience !== "world") return;
  await recordMembershipContentEvents([{ key: `story:${story._id}`, kind: "STORY", creator: story.creator?._id || story.creator, occurredAt: story.createdAt || new Date() }], story.$session?.());
}

export async function getMembershipRecap(membership, publicationIds, now = new Date()) {
  const start = new Date(membership.currentPeriodStart);
  const end = new Date(Math.min(now.getTime(), new Date(membership.currentPeriodEnd).getTime()));
  if (!Number.isFinite(start.getTime()) || start > end) return { stories: 0, chapters: 0, messages: 0 };
  const occurredAt = { $gte: start, $lt: end };
  const groups = await GroupConversation.find({ worldPublication: membership.premiumPublication, members: membership.user, deletedAt: null }).select("_id").lean();
  const [stories, chapters, messages] = await Promise.all([
    MembershipContentEvent.countDocuments({ creator: membership.creator, kind: "STORY", occurredAt }),
    MembershipContentEvent.countDocuments({ publication: { $in: publicationIds }, kind: "CHAPTER", occurredAt }),
    groups.length ? GroupMessage.countDocuments({ group: { $in: groups.map(group => group._id) }, createdAt: occurredAt, deletedAt: null, deletedFor: { $ne: membership.user } }) : 0,
  ]);
  return { stories, chapters, messages };
}
