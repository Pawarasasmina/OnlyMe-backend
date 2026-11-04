import Notification from "../models/Notification.js";
import FanProfile from "../models/FanProfile.js";
import CreatorProfile from "../models/CreatorProfile.js";

export async function notifyStory({ req, story, recipient, type, title, dedupeKey, messageId = null, reaction = null, mentionedUser = null }) {
  const sentMention = type === "story_mention_sent" && mentionedUser;
  if (!sentMention && String(recipient) === String(req.user._id)) return;
  const profiles = await Promise.all([FanProfile.findOne({ user: recipient }).select("notificationPreferences").lean(), CreatorProfile.findOne({ user: recipient }).select("notificationPreferences").lean()]);
  const category = type === "story_reaction" ? "reactions" : type === "story_reply" ? "messages" : "comments";
  if (!sentMention && profiles.some((profile) => profile?.notificationPreferences?.inApp === false || profile?.notificationPreferences?.[category] === false)) return;
  const update = { $set: {
    user: recipient, actor: sentMention ? mentionedUser : req.user._id, type, title, message: type === "story_mention" ? "Tap to add it to your story" : sentMention ? "" : story.caption || "",
    target: { type: "STORY", id: story._id, ...(messageId ? { messageId, conversationUserId: req.user._id } : {}) },
    metadata: { reaction },
  }, $setOnInsert: { dedupeKey } };
  try { await Notification.findOneAndUpdate({ dedupeKey }, update, { upsert: true, new: true, setDefaultsOnInsert: true }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    await Notification.findOneAndUpdate({ dedupeKey }, { $set: update.$set });
  }
  req.app.get("io")?.to(`user:${recipient}`).emit("activity:updated", { type, storyId: String(story._id) });
}
