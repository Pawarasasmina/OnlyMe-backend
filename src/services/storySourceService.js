import mongoose from "mongoose";
import Story from "../models/Story.js";
import { storyAudiencesFor } from "./storyAudienceService.js";

export async function resolveStorySources(stories, viewerId) {
  const ids = stories.map((story) => story.editorMetadata?.sourceStoryId).filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return;
  const sources = await Story.find({ _id: { $in: ids }, expiresAt: { $gt: new Date() }, audience: "everyone", allowSharing: { $ne: false } }).lean();
  for (const story of stories) {
    const sourceId = story.editorMetadata?.sourceStoryId;
    if (!sourceId) continue;
    const source = sources.find((item) => String(item._id) === String(sourceId));
    const allowed = source ? await storyAudiencesFor(source.creator, viewerId) : new Set();
    if (!source || !allowed.has("everyone")) {
      story.sourceUnavailable = true;
      story.editorMetadata = { ...story.editorMetadata, sharedCard: { ...story.editorMetadata.sharedCard, imageUrl: "", title: "Original story unavailable", subtitle: "Expired, deleted or restricted" } };
    }
  }
}

export async function filterStoryAccess(stories, viewerId) {
  const audiences = new Map();
  const visible = [];
  for (const story of stories) {
    const creatorId = String(story.creator?._id || story.creator);
    if (!audiences.has(creatorId)) audiences.set(creatorId, await storyAudiencesFor(creatorId, viewerId));
    if (audiences.get(creatorId).has(story.audience || "everyone")) visible.push(story);
  }
  await resolveStorySources(visible, viewerId);
  return visible;
}
