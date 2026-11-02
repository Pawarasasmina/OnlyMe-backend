import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import Chapter from "../models/Chapter.js";
import Publication from "../models/Publication.js";
import User from "../models/User.js";

const SOURCE = "approved-creator-paid-seens-v1";
const PLAN = [
  ["maya@gmail.com", "Maya Senanayake", "Psychology", 3, 2],
  ["noah@gmail.com", "Noah Williams", "Lifestyle", 2, 1],
  ["sofia@gmail.com", "Sofia Marin", "Fashion", 3, 2],
  ["oliver@gmail.com", "Oliver Brooks", "Finance", 2, 1],
  ["aisha@gmail.com", "Aisha Rahman", "Tech", 3, 2],
  ["liam@gmail.com", "Liam Carter", "Fitness", 2, 1],
  ["priya@gmail.com", "Priya Nair", "Wellness", 3, 2],
  ["lucas@gmail.com", "Lucas Reed", "Business", 2, 1],
  ["amara@gmail.com", "Amara Okafor", "Lifestyle", 3, 2],
  ["kenji@gmail.com", "Kenji Sato", "Fitness", 2, 1],
  ["elena@gmail.com", "Elena Petrova", "Psychology", 3, 2],
  ["marcus@gmail.com", "Marcus Lee", "Lifestyle", 2, 1],
  ["zara@gmail.com", "Zara Bennett", "Fashion", 3, 2],
  ["daniel@gmail.com", "Daniel Kim", "Business", 3, 2],
  ["nia@gmail.com", "Nia Campbell", "Tech", 3, 2],
  ["rafael@gmail.com", "Rafael Costa", "Fitness", 3, 2],
  ["chloe@gmail.com", "Chloe Martin", "Psychology", 2, 1],
  ["arjun@gmail.com", "Arjun Mehta", "Lifestyle", 2, 1],
  ["hana@gmail.com", "Hana Mori", "Fashion", 3, 2],
  ["victor@gmail.com", "Victor Mensah", "Tech", 3, 2],
];

const TOPICS = {
  Psychology: ["A Practical Reset for Overthinking", "Boundaries Without Guilt", "The Five-Minute Emotional Check-In"],
  Lifestyle: ["Design a Calmer Morning", "A Weekly Reset That Actually Fits", "Make Space for What Matters"],
  Fashion: ["Build a Signature Look", "Camera-Ready Styling Fundamentals", "A Versatile Capsule Wardrobe"],
  Finance: ["A Simple Monthly Money System", "Build Your First Safety Fund", "Spend With More Intention"],
  Business: ["A Simple Monthly Money System", "Build a Profitable Weekly Workflow", "Price Your Work With Confidence"],
  Tech: ["Use AI Without Losing Your Voice", "Automate One Repetitive Task", "Build a Reliable Personal Tech Stack"],
  Fitness: ["The Stronger Week Blueprint", "Mobility for Real Life", "Train Consistently Without Burnout"],
  Wellness: ["A Seven-Day Energy Reset", "Rest Without Falling Behind", "Build a Sustainable Self-Care Rhythm"],
};

const WORLD_NAMES = {
  Psychology: "The Inner Room", Lifestyle: "The Intentional Life", Fashion: "The Style Studio",
  Finance: "The Wealth Practice", Business: "The Growth Room", Tech: "The Future Lab",
  Fitness: "The Stronger Circle", Wellness: "The Wellbeing Room",
};

function stableId(key) {
  return new mongoose.Types.ObjectId(crypto.createHash("sha1").update(`${SOURCE}:${key}`).digest("hex").slice(0, 24));
}

function media(email, index) {
  const seed = encodeURIComponent(`${email}-paid-seen-${index}`);
  return { assetId: `${SOURCE}-${email}-${index}`, resourceType: "image", mediaType: "IMAGE", secureUrl: `https://picsum.photos/seed/${seed}/1200/800`, format: "jpg", width: 1200, height: 800 };
}

function paidSeenChapterCount(email, index) {
  const bucket = crypto.createHash("sha1").update(`${email}:${index}`).digest()[0] % 3;
  return 3 + bucket;
}

function paidSeenChapters(email, firstName, title, index) {
  const chapters = [
    {
      stableChapterId: `${SOURCE}-${email}-${index}-preview`, order: 0, title: "Start here", isPreview: true,
      releaseMode: "IMMEDIATE", releaseAt: null, draftVersion: 1,
      blocks: [
        { id: `${SOURCE}-${email}-${index}-preview-text`, type: "TEXT", order: 0, text: `${firstName} introduces ${title.toLowerCase()} with one useful idea you can apply today.` },
        { id: `${SOURCE}-${email}-${index}-preview-point`, type: "KEY_POINT", order: 1, text: "Small, repeatable actions create durable progress." },
      ],
    },
    {
      stableChapterId: `${SOURCE}-${email}-${index}-guide`, order: 1, title: "The complete guide", isPreview: false,
      releaseMode: "IMMEDIATE", releaseAt: null, draftVersion: 1,
      blocks: [
        { id: `${SOURCE}-${email}-${index}-guide-text`, type: "TEXT", order: 0, text: `${firstName} walks through the complete method, the common mistakes, and a practical plan for the next seven days.` },
        { id: `${SOURCE}-${email}-${index}-guide-list`, type: "LIST", order: 1, text: "Choose your starting point\nPractice one focused step\nReview and adjust", metadata: { listItems: ["Choose your starting point", "Practice one focused step", "Review and adjust"] } },
        { id: `${SOURCE}-${email}-${index}-guide-highlight`, type: "HIGHLIGHT", order: 2, text: "Begin with the smallest step you can repeat.", metadata: { color: "ICE_BLUE" } },
      ],
    },
    {
      stableChapterId: `${SOURCE}-${email}-${index}-plan`, order: 2, title: "Your seven-day action plan", isPreview: false,
      releaseMode: "IMMEDIATE", releaseAt: null, draftVersion: 1,
      blocks: [
        { id: `${SOURCE}-${email}-${index}-plan-text`, type: "TEXT", order: 0, text: `${firstName} turns the complete method into a realistic seven-day plan with space to review what works for you.` },
        { id: `${SOURCE}-${email}-${index}-plan-list`, type: "LIST", order: 1, text: "Days 1–2: establish your baseline\nDays 3–5: repeat the core practice\nDays 6–7: review, refine, and continue", metadata: { listItems: ["Days 1–2: establish your baseline", "Days 3–5: repeat the core practice", "Days 6–7: review, refine, and continue"] } },
        { id: `${SOURCE}-${email}-${index}-plan-point`, type: "KEY_POINT", order: 2, text: "Your plan should be clear enough to start and flexible enough to continue." },
      ],
    },
  ];
  const targetCount = paidSeenChapterCount(email, index);
  if (targetCount >= 4) chapters.push({
    stableChapterId: `${SOURCE}-${email}-${index}-practice`, order: 3, title: "Advanced practice", isPreview: false,
    releaseMode: "IMMEDIATE", releaseAt: null, draftVersion: 1,
    blocks: [
      { id: `${SOURCE}-${email}-${index}-practice-text`, type: "TEXT", order: 0, text: `${firstName} shows how to adapt the method when the first approach is not enough, without making the process unnecessarily complicated.` },
      { id: `${SOURCE}-${email}-${index}-practice-list`, type: "LIST", order: 1, text: "Notice what changed\nAdjust one variable\nRepeat long enough to learn", metadata: { listItems: ["Notice what changed", "Adjust one variable", "Repeat long enough to learn"] } },
      { id: `${SOURCE}-${email}-${index}-practice-highlight`, type: "HIGHLIGHT", order: 2, text: "Advanced does not mean complicated. It means more intentional.", metadata: { color: "MINT" } },
    ],
  });
  if (targetCount >= 5) chapters.push({
    stableChapterId: `${SOURCE}-${email}-${index}-reflection`, order: 4, title: "Reflect and continue", isPreview: false,
    releaseMode: "IMMEDIATE", releaseAt: null, draftVersion: 1,
    blocks: [
      { id: `${SOURCE}-${email}-${index}-reflection-text`, type: "TEXT", order: 0, text: `${firstName} closes the guide with a reflection that helps you keep the useful parts and choose the next meaningful step.` },
      { id: `${SOURCE}-${email}-${index}-reflection-point`, type: "KEY_POINT", order: 1, text: "Keep what worked, release what did not, and make the next step visible." },
      { id: `${SOURCE}-${email}-${index}-reflection-list`, type: "LIST", order: 2, text: "What felt easier?\nWhat created resistance?\nWhat will you repeat next week?", metadata: { listItems: ["What felt easier?", "What created resistance?", "What will you repeat next week?"] } },
    ],
  });
  return chapters;
}

function metadataForPaidSeen({ category, coverMedia, title }) {
  return {
    kind: "SEEN", title, summary: `A focused premium guide to ${title.toLowerCase()}.`,
    description: `A practical, structured guide with clear context, a complete method, and an actionable seven-day plan.`,
    category, tags: [category.toLowerCase(), "premium", "practical"], visibility: "PUBLIC", coverMedia,
    pricing: { mode: "ONE_TIME", starsAmount: 190, presetId: "ONE_TIME_190" }, previewPolicy: "ONE_CHAPTER",
    planet: { emoji: "", faceEmoji: "", accent: "ice-white" }, includedInWorld: false, includedExperienceIds: [],
    commentsEnabled: true, captionsEnabled: true, allowDownload: false, ownerWelcomeNote: "",
  };
}

async function seedPaidSeen(user, entry, index) {
  const [email, name, category] = entry;
  const firstName = name.split(" ")[0];
  const title = (TOPICS[category] || TOPICS.Lifestyle)[index];
  const publicationId = stableId(`${email}:paid-seen:${index + 1}`);
  const chapters = paidSeenChapters(email, firstName, title, index + 1);
  const metadata = metadataForPaidSeen({ category, coverMedia: media(email, index + 1), title });
  const now = new Date(Date.now() - (index + 1) * 60 * 60_000);
  await Publication.findOneAndUpdate(
    { _id: publicationId },
    { $set: { creator: user._id, ...metadata, status: "PUBLISHED", draftVersion: 1, submittedVersion: 1, publishedVersion: 1, statusVersion: 1, submittedSnapshot: { version: 1, metadata, chapters, frozenAt: now }, publishedSnapshot: { version: 1, metadata, chapters, frozenAt: now }, submittedAt: now, publishedAt: now, seedSource: SOURCE, seedKey: `paid-seen-${index + 1}` } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await Chapter.deleteMany({ publication: publicationId });
  await Chapter.insertMany(chapters.map((chapter) => ({ publication: publicationId, ...chapter })));
  return publicationId;
}

async function ensureWorld(user, entry, includedIds) {
  const [email, name, category] = entry;
  const firstName = name.split(" ")[0];
  let world = await Publication.findOne({ creator: user._id, kind: "PREMIUM_WORLD", status: { $in: ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "PUBLISHED"] } }).select("+submittedSnapshot");
  if (!world) {
    const title = WORLD_NAMES[category] || `${firstName}'s World`;
    const metadata = {
      kind: "PREMIUM_WORLD", title, summary: `Premium guidance, private updates, and closer access to ${firstName}.`,
      description: `Join ${firstName} for member-only Paid Seens, private stories, and practical updates every month.`,
      category, tags: [category.toLowerCase(), "community", "premium"], visibility: "PUBLIC",
      pricing: { mode: "MONTHLY", starsAmount: 190, presetId: "MONTHLY_190" }, previewPolicy: "ONE_CHAPTER",
      planet: { slot: "PREMIUM", emoji: "🪐", faceEmoji: "", accent: "ice-white" }, includedExperienceIds: includedIds,
      commentsEnabled: true, firstMonthOfferEnabled: false, memberPriceLocked: true, directAccessIncluded: true,
      directAccessIncludedReplies: 1, worldFoundingCapacity: 250, worldSeatCapacity: 250, worldWaveSize: 100,
      ownerWelcomeNote: `Welcome inside. Start with one of the included Paid Seens, then say hi — ${firstName}.`,
    };
    const now = new Date();
    world = await Publication.findOneAndUpdate(
      { _id: stableId(`${email}:premium-world`) },
      { $set: { creator: user._id, ...metadata, status: "PUBLISHED", draftVersion: 1, submittedVersion: 1, publishedVersion: 1, statusVersion: 1, submittedSnapshot: { version: 1, metadata, chapters: [], frozenAt: now }, publishedSnapshot: { version: 1, metadata, chapters: [], frozenAt: now }, submittedAt: now, publishedAt: now, seedSource: SOURCE, seedKey: "premium-world" } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } else {
    world.includedExperienceIds = includedIds;
    world.includedInWorld = false;
    world.statusVersion += 1;
    for (const snapshotKey of ["submittedSnapshot", "publishedSnapshot"]) {
      if (!world[snapshotKey]?.metadata) continue;
      world[snapshotKey].metadata = { ...world[snapshotKey].metadata, includedExperienceIds: includedIds };
      world.markModified(`${snapshotKey}.metadata`);
    }
    await world.save();
  }
  return world._id;
}

async function run() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed creator content while NODE_ENV=production.");
  await connectDb();
  const emails = PLAN.map(([email]) => email);
  const users = await User.find({ email: { $in: emails } }).select("_id email name role status creatorApprovalStatus");
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const missing = emails.filter((email) => !byEmail.has(email));
  if (missing.length) throw new Error(`No changes made. Missing creator accounts: ${missing.join(", ")}`);
  const invalid = users.filter((user) => !["fan", "creator"].includes(user.role) || user.status !== "active" || user.creatorApprovalStatus !== "approved");
  if (invalid.length) throw new Error(`No changes made. These accounts do not have active approved creator access: ${invalid.map((user) => user.email).join(", ")}`);

  const report = [];
  for (const entry of PLAN) {
    const [email, name, , paidSeenCount, includedCount] = entry;
    const user = byEmail.get(email);
    const paidSeenIds = [];
    for (let index = 0; index < paidSeenCount; index += 1) paidSeenIds.push(await seedPaidSeen(user, entry, index));
    const includedIds = paidSeenIds.slice(0, includedCount);
    const worldId = await ensureWorld(user, entry, includedIds);
    const chapterCounts = paidSeenIds.map((_, index) => paidSeenChapterCount(email, index + 1));
    report.push({ creator: name, email, paidSeens: paidSeenIds.length, chapters: chapterCounts.join("/"), includedInWorld: includedIds.length, worldId: String(worldId) });
  }
  console.table(report);
  const chapterDistribution = { 3: 0, 4: 0, 5: 0 };
  PLAN.forEach(([email, , , paidSeenCount]) => { for (let index = 1; index <= paidSeenCount; index += 1) chapterDistribution[paidSeenChapterCount(email, index)] += 1; });
  console.log(JSON.stringify({ creators: report.length, paidSeens: report.reduce((sum, row) => sum + row.paidSeens, 0), worlds: report.length, worldInclusions: report.reduce((sum, row) => sum + row.includedInWorld, 0), chapterDistribution }));
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => mongoose.disconnect());
