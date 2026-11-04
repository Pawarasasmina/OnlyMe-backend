import mongoose from "mongoose";
import { readdir } from "node:fs/promises";
import { env } from "../config/env.js";
import Story from "../models/Story.js";
import Notification from "../models/Notification.js";
import { getFanActivity } from "../controllers/fanController.js";

try {
  for (const file of await readdir(new URL("../models/", import.meta.url))) {
    if (file.endsWith(".js") && !file.endsWith(".test.js")) await import(new URL(`../models/${file}`, import.meta.url));
  }
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
  const stories = await Story.find({ "editorMetadata.mentions.0": { $exists: true } }).sort({ createdAt: -1 }).limit(10).select("creator createdAt audience editorMetadata.mentions").lean();
  const rows = [];
  for (const story of stories) {
    let activity;
    let failure;
    await getFanActivity({ user: { _id: story.creator }, query: { direction: "sent", filter: "mentions" } },
      { status() { return this; }, json(value) { activity = value; } }, (error) => { failure = error; });
    if (failure) throw failure;
    rows.push({ storyId: String(story._id), createdAt: story.createdAt, audience: story.audience, mentionCount: story.editorMetadata.mentions.length,
      sentActivityRows: activity.data.items.filter((item) => item.target?.id === String(story._id)).length,
      receivedCount: await Notification.countDocuments({ "target.id": story._id, type: "story_mention" }),
      sentCount: await Notification.countDocuments({ "target.id": story._id, type: "story_mention_sent" }) });
  }
  console.log(JSON.stringify(rows, null, 2));
} finally { await mongoose.disconnect(); }
