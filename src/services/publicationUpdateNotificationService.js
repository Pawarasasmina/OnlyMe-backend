import Publication from "../models/Publication.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { coverPreview } from "./activitySupplementService.js";

export async function notifyAddedChapters(previous, publication) {
  await notifyTaggedPeople(previous, publication);
  if (!previous.publishedSnapshot?.chapters?.length || !publication.publishedSnapshot?.chapters?.length) return { sent: 0 };
  const before = new Set(previous.publishedSnapshot.chapters.map(chapter => String(chapter.stableChapterId)));
  const added = publication.publishedSnapshot.chapters.filter(chapter => !before.has(String(chapter.stableChapterId)));
  if (!added.length) return { sent: 0 };
  const worlds = await Publication.distinct("_id", { creator: publication.creator, kind: "PREMIUM_WORLD", status: "PUBLISHED", includedExperienceIds: publication._id });
  const [owners, members, creator] = await Promise.all([
    WorldEntitlement.distinct("user", { publication: publication._id, status: "ACTIVE" }),
    PremiumMembership.distinct("user", { premiumPublication: { $in: [publication._id, ...worlds] }, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } }),
    User.findById(publication.creator).select("name username").lean(),
  ]);
  const recipients = [...new Set([...owners, ...members].map(String))].filter(user => user !== String(publication.creator));
  const title = publication.publishedSnapshot.metadata?.title || publication.title;
  for (let offset = 0; offset < recipients.length; offset += 500) await Notification.bulkWrite(recipients.slice(offset, offset + 500).map(user => {
    const dedupeKey = `publication-chapters:${publication._id}:${publication.publishedVersion}:${user}`;
    return { updateOne: { filter: { dedupeKey }, update: { $setOnInsert: { user, actor: publication.creator, type: "publication_chapter_added", title: `${creator?.name || creator?.username || "The creator"} added ${added.length === 1 ? "a chapter" : `${added.length} chapters`} to ${title}`, message: added.map(chapter => chapter.title).filter(Boolean).join(" · ").slice(0, 500), target: { type: publication.kind, id: publication._id }, metadata: { chapterId: added[0].stableChapterId, cover: coverPreview(publication) }, dedupeKey } }, upsert: true } };
  }));
  return { sent: recipients.length };
}

async function notifyTaggedPeople(previous, publication) {
  if (publication.kind !== "SEEN") return;
  const before = new Set((previous.publishedSnapshot?.metadata?.taggedPeople || []).map(String));
  const people = [...new Set((publication.publishedSnapshot?.metadata?.taggedPeople || []).map(String))].filter(id => id !== String(publication.creator) && !before.has(id));
  if (!people.length) return;
  const creator = await User.findById(publication.creator).select("name username").lean();
  await Notification.bulkWrite(people.map(user => {
    const dedupeKey = `publication-tag:${publication._id}:${publication.publishedVersion}:${user}`;
    return { updateOne: { filter: { dedupeKey }, update: { $setOnInsert: { user, actor: publication.creator, type: "publication_tag", title: `${creator?.name || creator?.username || "Someone"} tagged you in a Seen`, message: publication.publishedSnapshot.metadata.title || publication.title, target: { type: "SEEN", id: publication._id }, metadata: { cover: coverPreview(publication) }, dedupeKey } }, upsert: true } };
  }));
}
