import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import Story from "../models/Story.js";
import User from "../models/User.js";
import { storyExpiresAt } from "../services/storyExpiryService.js";

const SEED_SOURCE = "creator-stories-v1";
const HOUR = 60 * 60 * 1000;

const STORY_TEMPLATES = [
  {
    caption: "A little behind-the-scenes moment from today.",
    imageUrl: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=900&h=1600&q=80",
  },
  {
    caption: "Creating, learning, and enjoying the process.",
    imageUrl: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=900&h=1600&q=80",
  },
  {
    caption: "A fresh update for everyone following along.",
    imageUrl: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&h=1600&q=80",
  },
];

async function seed() {
  if (env.nodeEnv === "production") {
    throw new Error("Refusing to seed creator stories while NODE_ENV=production.");
  }

  await connectDb();

  const users = await User.find({
    role: { $in: ["fan", "creator"] },
    status: "active",
  }).select("+accountType _id name username role").sort({ username: 1 }).lean();

  const now = new Date();
  let created = 0;
  let refreshed = 0;

  const testUserIds = users.filter((user) => user.accountType === "TEST").map((user) => user._id);
  if (testUserIds.length) {
    await Story.updateMany(
      { creator: { $in: testUserIds } },
      { $set: { expiresAt: storyExpiresAt("TEST", now) } },
    );
  }

  for (const creator of users) {
    for (const [index, template] of STORY_TEMPLATES.entries()) {
      const assetId = `${SEED_SOURCE}:${creator._id}:${index + 1}`;
      const createdAt = new Date(now.getTime() - (index * 37 + 5) * 60 * 1000);
      const result = await Story.updateOne(
        { creator: creator._id, "image.assetId": assetId },
        {
          $set: {
            creator: creator._id,
            caption: template.caption,
            image: { assetId, url: template.imageUrl, resourceType: "image" },
            mediaType: "image",
            sourceType: "original",
            sourceSeen: null,
            duration: 5,
            audience: "everyone",
            allowReactions: true,
            allowReplies: true,
            allowSharing: true,
            createdAt,
            updatedAt: createdAt,
            expiresAt: creator.accountType === "TEST"
              ? storyExpiresAt(creator.accountType, now)
              : new Date(storyExpiresAt(creator.accountType, now).getTime() - index * HOUR),
          },
        },
        { upsert: true, setDefaultsOnInsert: true, timestamps: false },
      );

      if (result.upsertedCount) created += 1;
      else refreshed += 1;
    }
  }

  const activeSeedStories = await Story.countDocuments({
    "image.assetId": { $regex: `^${SEED_SOURCE}:` },
    expiresAt: { $gt: now },
  });

  console.log(JSON.stringify({ users: users.length, created, refreshed, activeSeedStories }, null, 2));
}

seed()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
