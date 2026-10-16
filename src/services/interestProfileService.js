import UserInterestProfile from "../models/UserInterestProfile.js";

const WEIGHTS = { FOLLOW: 10, SAVE: 8, SHARE: 8, CONTENT_REPLAY: 7, CONTENT_COMPLETED: 6, REACTION: 4, PROFILE_VIEW: 3, CONTENT_WATCH: 3, FAST_SKIP: -6, NOT_INTERESTED: -15, HIDE: -30 };
const normalize = (value) => String(value || "").trim().toLowerCase().slice(0, 80);

function applyScore(rows, key, delta, eventType, now) {
  const normalizedKey = normalize(key);
  if (!normalizedKey || !delta) return;
  const row = rows.find((item) => item.key === normalizedKey);
  if (row) {
    row.score = Math.max(-1000, Math.min(1000, Number(row.score || 0) + delta));
    row.positive = Number(row.positive || 0) + (delta > 0 ? delta : 0);
    row.negative = Number(row.negative || 0) + (delta < 0 ? Math.abs(delta) : 0);
    row.lastSignalAt = now;
    row.signals = { ...(row.signals || {}), [eventType]: Number(row.signals?.[eventType] || 0) + 1 };
    if (typeof row.markModified === "function") row.markModified("signals");
  } else rows.push({ key: normalizedKey, score: delta, positive: Math.max(0, delta), negative: Math.max(0, -delta), signals: { [eventType]: 1 }, lastSignalAt: now });
  rows.sort((left, right) => Math.abs(right.score) - Math.abs(left.score));
  if (rows.length > 200) rows.length = 200;
}

export async function updateInterestProfileFromEvent({ eventType, metadata = {}, userId, now = new Date() }) {
  const base = WEIGHTS[eventType] || 0;
  if (!base || !userId) return null;
  let weight = base;
  if (eventType === "CONTENT_WATCH") weight *= Math.max(0.25, Math.min(2, Number(metadata.completion) || Number(metadata.watchMs) / Math.max(1, Number(metadata.durationMs)) || 0.5));
  const profile = await UserInterestProfile.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  for (const topic of Array.isArray(metadata.topics) ? metadata.topics : []) applyScore(profile.topicScores, topic, weight, eventType, now);
  applyScore(profile.creatorScores, metadata.creatorId || metadata.targetUserId, weight, eventType, now);
  applyScore(profile.formatScores, metadata.contentType, weight, eventType, now);
  profile.signalCount += 1;
  profile.lastSignalAt = now;
  await profile.save();
  return profile;
}
