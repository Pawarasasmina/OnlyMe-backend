import Repost from "../models/Repost.js";

export async function syncRepost({ enabled, kind, originalAuthor, targetId, targetModel, user }) {
  const filter = { user, kind, targetId };
  if (!enabled) { await Repost.deleteOne(filter); return null; }
  if (String(originalAuthor) === String(user)) return null;
  return Repost.findOneAndUpdate(filter, { $set: { originalAuthor, targetModel } }, { upsert: true, new: true, runValidators: true });
}
