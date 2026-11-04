import Message from "../models/Message.js";

// A stable key isolates reaction cards from ordinary story replies.
export async function upsertStoryReactionMessage({ story, senderId, reaction }) {
  const storyReactionKey = `${story._id}:${senderId}:${story.creator}`;
  const filter = { storyReactionKey };
  const update = {
    $set: { body: reaction ? `Reacted ${reaction} to your story` : "Story reaction removed" },
    $setOnInsert: { sender: senderId, recipient: story.creator, mediaType: "text", ppm: false, storyReactionKey,
      storyReply: { story: story._id, imageUrl: story.image.url, caption: story.caption, expiresAt: story.expiresAt, questionPrompt: "" } },
  };
  try {
    return await Message.findOneAndUpdate(filter, update, { upsert: Boolean(reaction), new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Message.findOneAndUpdate(filter, { $set: update.$set }, { new: true });
  }
}
