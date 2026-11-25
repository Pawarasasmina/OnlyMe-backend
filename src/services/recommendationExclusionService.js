import RecommendationExclusion from "../models/RecommendationExclusion.js";
import mongoose from "mongoose";
import Story from "../models/Story.js";
import Publication from "../models/Publication.js";

const id = value => String(value?._id || value?.id || value || "");
export function exclusionState(rows = []) {
  return { accounts: new Set(rows.filter(row => row.targetModel === "User").map(row => id(row.targetId))), items: new Set(rows.filter(row => row.targetModel !== "User").map(row => id(row.targetId))) };
}
export async function getRecommendationExclusions() {
  // Read on every request: exclusions and restores must take effect immediately.
  return exclusionState(await RecommendationExclusion.find().select("targetModel targetId").lean());
}
export function isRecommendationExcluded(item, state) {
  const owner = item.creator || item.author || item.user || item.owner;
  return state.accounts.has(id(owner)) || state.accounts.has(id(item.sharedBy))
    || state.accounts.has(id(item.sourceSeen?.creator))
    || [item._id, item.id, item.originalPostId, item.sourceSeen, item.sourceSeen?.id, item.publicationId, item.editorMetadata?.sourceStoryId].some(value => value && state.items.has(id(value)));
}
export function filterRecommendationItems(items, state) {
  return items.filter(item => !isRecommendationExcluded(item, state)).map(item => {
    if (!Array.isArray(item.stories)) return item;
    const stories = item.stories.filter(story => !isRecommendationExcluded(story, state));
    return { ...item, stories, storyCount: stories.length };
  }).filter(item => !Array.isArray(item.stories) || item.stories.length || item.activeStatus);
}

export async function filterExcludedStorySources(stories, state) {
  let allowed = stories.filter(story => !isRecommendationExcluded(story, state));
  if (!state.accounts.size || !allowed.length) return allowed;
  const sourceStories = allowed.map(story => story.editorMetadata?.sourceStoryId).filter(value => mongoose.isValidObjectId(value));
  const sourceSeens = allowed.map(story => id(story.sourceSeen)).filter(value => mongoose.isValidObjectId(value));
  const [excludedStories, excludedSeens] = await Promise.all([
    sourceStories.length ? Story.find({ _id: { $in: sourceStories }, creator: { $in: [...state.accounts] } }).select("_id").lean() : [],
    sourceSeens.length ? Publication.find({ _id: { $in: sourceSeens }, creator: { $in: [...state.accounts] } }).select("_id").lean() : [],
  ]);
  const sources = new Set([...excludedStories, ...excludedSeens].map(row => id(row)));
  allowed = allowed.filter(story => !sources.has(id(story.sourceSeen)) && !sources.has(id(story.editorMetadata?.sourceStoryId)));
  return allowed;
}
