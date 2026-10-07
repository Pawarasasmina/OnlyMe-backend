import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import FeedPost from "../models/FeedPost.js";
import Publication from "../models/Publication.js";
import User from "../models/User.js";

const SEED_SOURCE = "creator-demo-content-v1";

const DEMOS = [
  {
    username: "creator2",
    seen: {
      category: "Lifestyle",
      title: "A Better Morning in 20 Minutes",
      summary: "A practical reset for starting the day with more clarity and less noise.",
      cover: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1200&q=80",
      chapters: [
        { title: "Start quietly", blocks: [{ type: "KEY_POINT", text: "Keep the first ten minutes free from notifications." }, { type: "TEXT", text: "Open a window, drink water, and give your attention time to arrive before the rest of the world does." }] },
        { title: "Choose the day", blocks: [{ type: "HIGHLIGHT", text: "One clear priority beats a crowded list." }, { type: "TEXT", text: "Write down the one result that would make today feel meaningful, then begin with its smallest useful step." }] },
      ],
    },
    notes: [
      { context: "Right now", location: "Dubai, United Arab Emirates", text: "Trying a slower start today: water, sunlight, then the first important task before opening messages." },
      { context: "Advice", location: "Dubai, United Arab Emirates", text: "If your list feels overwhelming, choose the one task that makes everything else easier and start there." },
    ],
  },
  {
    username: "creator22",
    seen: {
      category: "Food",
      title: "Three Small Details That Improve Every Meal",
      summary: "Simple ways to make everyday food feel more thoughtful without making it complicated.",
      cover: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80",
      chapters: [
        { title: "Build contrast", blocks: [{ type: "TEXT", text: "Pair something warm with something fresh, and something soft with a little crunch." }, { type: "KEY_POINT", text: "Texture is often the difference between a good plate and a memorable one." }] },
        { title: "Finish with care", blocks: [{ type: "HIGHLIGHT", text: "Taste once more before serving." }, { type: "TEXT", text: "A final touch of acid, herbs, or seasoning can bring the whole plate into focus." }] },
      ],
    },
    notes: [
      { context: "Restaurant", location: "Colombo, Sri Lanka", text: "Found a tiny lunch spot where the simplest curry was the best thing on the table. Fresh, balanced, and made with care." },
      { context: "Coffee", location: "Colombo, Sri Lanka", text: "Today’s reminder: ask the barista what was roasted most recently. The answer is usually more interesting than the menu." },
    ],
  },
  {
    username: "creatort",
    seen: {
      category: "Travel",
      title: "How to Really See a New City",
      summary: "A slower travel approach for finding the places and moments that guidebooks miss.",
      cover: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80",
      chapters: [
        { title: "Walk without a checklist", blocks: [{ type: "KEY_POINT", text: "Leave one afternoon completely unplanned." }, { type: "TEXT", text: "Follow the streets that feel alive, stop where local people linger, and let curiosity set the route." }] },
        { title: "Remember the feeling", blocks: [{ type: "HIGHLIGHT", text: "Collect moments, not only landmarks." }, { type: "TEXT", text: "Write one sentence at the end of the day about what surprised you. That is often the memory that lasts." }] },
      ],
    },
    notes: [
      { context: "Travel", location: "Abu Dhabi, United Arab Emirates", text: "The best part of exploring today was the hour with no route—just shade, side streets, and a place full of locals." },
      { context: "Things to do", location: "Abu Dhabi, United Arab Emirates", text: "Try the waterfront just before sunset. It is cooler, quieter, and the city changes completely as the lights come on." },
    ],
  },
  {
    username: "creator3",
    seen: {
      category: "Fitness",
      title: "The Workout You Can Actually Repeat",
      summary: "A sustainable movement routine designed for busy days and consistent progress.",
      cover: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80",
      chapters: [
        { title: "Lower the barrier", blocks: [{ type: "KEY_POINT", text: "A short session completed is better than a perfect session postponed." }, { type: "TEXT", text: "Choose four movements, set a twenty-minute timer, and focus on clean repetitions rather than exhaustion." }] },
        { title: "Make it repeatable", blocks: [{ type: "HIGHLIGHT", text: "Finish with enough energy to return tomorrow." }, { type: "TEXT", text: "Consistency grows when training supports the rest of your life instead of competing with it." }] },
      ],
    },
    notes: [
      { context: "Fitness", location: "London, United Kingdom", text: "Twenty focused minutes today. Nothing dramatic—just the kind of session I can repeat all week." },
      { context: "Advice", location: "London, United Kingdom", text: "When motivation is low, reduce the workout instead of cancelling it. Keep the promise, even in a smaller form." },
    ],
  },
];

function publicationChapters(username, seen) {
  return seen.chapters.map((chapter, chapterIndex) => ({
    stableChapterId: `${SEED_SOURCE}-${username}-chapter-${chapterIndex + 1}`,
    order: chapterIndex,
    title: chapter.title,
    isPreview: true,
    locked: false,
    blocks: chapter.blocks.map((block, blockIndex) => ({
      id: `${SEED_SOURCE}-${username}-chapter-${chapterIndex + 1}-block-${blockIndex + 1}`,
      order: blockIndex,
      ...block,
    })),
  }));
}

async function seedSeen(user, demo, publishedAt) {
  const seedKey = `${demo.username}-seen`;
  const coverMedia = {
    assetId: `${SEED_SOURCE}-${seedKey}-cover`,
    resourceType: "image",
    mediaType: "IMAGE",
    secureUrl: demo.seen.cover,
    format: "jpg",
  };
  const metadata = {
    kind: "SEEN",
    title: demo.seen.title,
    summary: demo.seen.summary,
    description: demo.seen.summary,
    category: demo.seen.category,
    tags: ["sample", "demo"],
    coverMedia,
    visibility: "PUBLIC",
    pricing: { mode: "FREE", starsAmount: null, presetId: null },
    planet: { slot: null, emoji: "", accent: "" },
  };
  const chapters = publicationChapters(demo.username, demo.seen);

  await Publication.findOneAndUpdate(
    { creator: user._id, seedSource: SEED_SOURCE, seedKey },
    {
      $set: {
        creator: user._id,
        ...metadata,
        previewPolicy: "ALL_FREE",
        status: "PUBLISHED",
        publishedSnapshot: { version: 1, metadata, chapters, frozenAt: publishedAt },
        publishedVersion: 1,
        publishedAt,
        seedSource: SEED_SOURCE,
        seedKey,
      },
      $setOnInsert: { draftVersion: 1, statusVersion: 0 },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

async function seedNotes(user, demo, baseTime) {
  await Promise.all(demo.notes.map((note, index) => {
    const seedKey = `${demo.username}-note-${index + 1}`;
    const publishedAt = new Date(baseTime.getTime() - (index + 1) * 45 * 60_000);
    return FeedPost.findOneAndUpdate(
      { author: user._id, seedSource: SEED_SOURCE, seedKey },
      {
        $set: {
          author: user._id,
          text: note.text,
          context: note.context,
          location: note.location,
          media: [],
          visibility: "public",
          status: "published",
          deletedAt: null,
          publishedAt,
          seedSource: SEED_SOURCE,
          seedKey,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }));
}

async function seed() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed creator demo content while NODE_ENV=production.");
  await connectDb();

  const usernames = DEMOS.map((demo) => demo.username);
  const users = await User.find({ username: { $in: usernames }, role: "creator" });
  const usersByUsername = new Map(users.map((user) => [user.username, user]));
  const missing = usernames.filter((username) => !usersByUsername.has(username));
  if (missing.length) throw new Error(`Existing creator account${missing.length === 1 ? "" : "s"} not found: ${missing.map((name) => `@${name}`).join(", ")}`);

  const baseTime = new Date();
  for (const [index, demo] of DEMOS.entries()) {
    const user = usersByUsername.get(demo.username);
    await seedSeen(user, demo, new Date(baseTime.getTime() - index * 30 * 60_000));
    await seedNotes(user, demo, baseTime);
  }

  console.log(`Seeded ${DEMOS.length} Seens and ${DEMOS.reduce((total, demo) => total + demo.notes.length, 0)} Wall notes for ${usernames.map((name) => `@${name}`).join(", ")}.`);
}

seed()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
