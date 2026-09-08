import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import Publication from "../models/Publication.js";
import User from "../models/User.js";

const SEED_SOURCE = "seen-flow-samples-v1";
const CREATOR_USERNAME = (process.env.SEEN_FLOW_CREATOR_USERNAME || "creator2").trim();

const samples = [
  {
    key: "sunrise-reset",
    title: "Sunrise Reset",
    summary: "A quiet three-step morning reset before the city wakes up.",
    category: "Lifestyle",
    cover: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1200&q=80",
    chapters: [
      { title: "Before the phone", blocks: [{ type: "KEY_POINT", text: "The first ten minutes belong to you, not the notification list." }, { type: "TEXT", text: "Leave the phone charging outside the room and open the window before doing anything else." }] },
      { title: "One glass of water", blocks: [{ type: "TEXT", text: "Drink slowly, while standing by the window. This is a pause, not another task to finish." }, { type: "HIGHLIGHT", text: "Small rituals work when they are easy enough to repeat." }] },
      { title: "Choose one thing", blocks: [{ type: "KEY_POINT", text: "Write down the single thing that would make today feel complete." }, { type: "TEXT", text: "Everything else can move. Protect this one promise first." }] },
    ],
  },
  {
    key: "coffee-walk-notes",
    title: "Coffee Walk Notes",
    summary: "Three observations from the same neighborhood walk every Sunday.",
    category: "Wellness",
    cover: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80",
    chapters: [
      { title: "Take the long street", blocks: [{ type: "TEXT", text: "The longer route has less traffic and enough silence to notice what your week was really like." }, { type: "HIGHLIGHT", text: "The slower road usually gives the clearer answer." }] },
      { title: "Order at the counter", blocks: [{ type: "KEY_POINT", text: "Stay at the counter for five minutes before taking the coffee away." }, { type: "TEXT", text: "No scrolling. Watch the room arrive and let your thoughts settle." }] },
    ],
  },
  {
    key: "evening-desk-close",
    title: "Close the Day Well",
    summary: "A simple shutdown ritual that makes tomorrow easier to begin.",
    category: "Productivity",
    cover: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1200&q=80",
    chapters: [
      { title: "Clear the surface", blocks: [{ type: "TEXT", text: "Put every loose object back where it belongs. A clear desk is a visible ending." }] },
      { title: "Leave a first step", blocks: [{ type: "KEY_POINT", text: "Write tomorrow's first action as a verb, not a vague project name." }, { type: "TEXT", text: "Open the right document and leave the exact next step at the top." }] },
      { title: "Walk away", blocks: [{ type: "HIGHLIGHT", text: "A finished day needs a real ending." }, { type: "TEXT", text: "Turn off the desk light and do not return for one more tiny task." }] },
    ],
  },
];

function media(sample) {
  return {
    assetId: `${SEED_SOURCE}-${sample.key}-cover`,
    resourceType: "image",
    mediaType: "IMAGE",
    secureUrl: sample.cover,
    format: "jpg",
  };
}

function chapterPayload(sample) {
  return sample.chapters.map((chapter, chapterIndex) => ({
    stableChapterId: `${SEED_SOURCE}-${sample.key}-chapter-${chapterIndex + 1}`,
    order: chapterIndex,
    title: chapter.title,
    isPreview: true,
    locked: false,
    blocks: chapter.blocks.map((block, blockIndex) => ({
      id: `${SEED_SOURCE}-${sample.key}-chapter-${chapterIndex + 1}-block-${blockIndex + 1}`,
      order: blockIndex,
      ...block,
    })),
  }));
}

async function seed() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed Seen samples while NODE_ENV=production.");
  await connectDb();

  const creator = await User.findOne({ username: CREATOR_USERNAME, role: "creator" });
  if (!creator) throw new Error(`Existing creator @${CREATOR_USERNAME} was not found.`);

  for (const [index, sample] of samples.entries()) {
    const chapters = chapterPayload(sample);
    const coverMedia = media(sample);
    const publishedAt = new Date(Date.now() - (index + 1) * 60_000);
    const metadata = {
      kind: "SEEN",
      title: sample.title,
      summary: sample.summary,
      description: sample.summary,
      category: sample.category,
      tags: ["sample", "seen-flow"],
      coverMedia,
      visibility: "PUBLIC",
      pricing: { mode: "FREE", starsAmount: null, presetId: null },
      planet: { slot: null, emoji: "", accent: "" },
    };
    const snapshot = { version: 1, metadata, chapters, frozenAt: publishedAt };

    await Publication.findOneAndUpdate(
      { creator: creator._id, seedSource: SEED_SOURCE, seedKey: sample.key },
      {
        $set: {
          creator: creator._id,
          ...metadata,
          previewPolicy: "ALL_FREE",
          status: "PUBLISHED",
          publishedSnapshot: snapshot,
          publishedVersion: 1,
          publishedAt,
          seedSource: SEED_SOURCE,
          seedKey: sample.key,
        },
        $setOnInsert: { draftVersion: 1, statusVersion: 0 },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  console.log(`Seeded ${samples.length} Seen flow samples for @${creator.username} (${creator._id}).`);
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect();
  process.exit(1);
});
