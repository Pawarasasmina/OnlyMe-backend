import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import Chapter from "../models/Chapter.js";
import CreatorProfile from "../models/CreatorProfile.js";
import Dream from "../models/Dream.js";
import ExperienceAccessRequest from "../models/ExperienceAccessRequest.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import FinancialCommand from "../models/FinancialCommand.js";
import Notification from "../models/Notification.js";
import OrbitDream from "../models/OrbitDream.js";
import ProfileMedia from "../models/ProfileMedia.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import Story from "../models/Story.js";
import StoryEngagement from "../models/StoryEngagement.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import User from "../models/User.js";
import WallEngagement from "../models/WallEngagement.js";
import WallPost from "../models/WallPost.js";
import Wallet from "../models/Wallet.js";
import { sendChatGift } from "../controllers/messageController.js";
import { sendDreamGift } from "../services/dreamService.js";
import { giftsForRecipient } from "../services/giftPreferenceService.js";
import { joinPremium } from "../services/premiumMembershipService.js";
import { purchaseWorld } from "../services/worldPurchaseService.js";
import { getStarExchangeRate } from "../services/starExchangeService.js";

const SOURCE = "client-showcase-v1";
const PASSWORD = "12341234";
const HOUR = 60 * 60_000;

const creators = [
  { first: "Maya", last: "Senanayake", username: "mayamind", category: "Psychology", city: "Colombo", country: "Sri Lanka", color: "7c3aed", bio: "Psychologist translating emotional science into calmer, more connected everyday lives.", quote: "Name the feeling, then choose the next kind step.", seen: ["How to Stop Overthinking Tonight", "Boundaries Without Guilt"], world: "The Inner Room", worldSummary: "Weekly guided reflections, emotional tools, and honest conversations for a steadier mind." },
  { first: "Noah", last: "Williams", username: "noahliving", category: "Lifestyle", city: "London", country: "United Kingdom", color: "0f766e", bio: "Slow living, thoughtful routines, and practical ways to make ordinary days feel better.", quote: "A good life is built in small, repeatable moments.", seen: ["A Morning That Gives Energy Back", "Make Your Home Feel Lighter"], world: "The Everyday Edit", worldSummary: "A private lifestyle club for routines, home resets, and intentional weekly planning." },
  { first: "Sofia", last: "Marin", username: "sofiamarin", category: "Fashion", city: "Barcelona", country: "Spain", color: "db2777", bio: "Model and creative director sharing the craft, confidence, and reality behind the camera.", quote: "Style begins when performance ends.", seen: ["Pose With Presence", "What Casting Days Really Look Like"], world: "Backstage With Sofia", worldSummary: "Behind-the-scenes shoots, model coaching, styling notes, and monthly live critiques." },
  { first: "Oliver", last: "Brooks", username: "oliverwealth", category: "Business", city: "Toronto", country: "Canada", color: "ca8a04", bio: "Personal finance educator making money systems understandable, calm, and genuinely useful.", quote: "Clarity compounds before money does.", seen: ["Your First Simple Budget", "Three Money Leaks to Fix"], world: "Calm Money Club", worldSummary: "Monthly financial workshops, templates, portfolio lessons, and judgment-free money conversations." },
  { first: "Aisha", last: "Rahman", username: "aishabuildsai", category: "Tech", city: "Dubai", country: "United Arab Emirates", color: "2563eb", bio: "AI builder explaining useful tools, responsible workflows, and the future without the hype.", quote: "Use AI to expand judgment, not replace it.", seen: ["Build Your First AI Workflow", "Prompting Is Really Context Design"], world: "Applied AI Lab", worldSummary: "Hands-on AI experiments, workflow breakdowns, office hours, and responsible building practices." },
  { first: "Liam", last: "Carter", username: "liamtrains", category: "Fitness", city: "Sydney", country: "Australia", color: "dc2626", bio: "Strength coach focused on sustainable training, good movement, and confidence that lasts.", quote: "Train for the life outside the gym.", seen: ["The Workout You Can Repeat", "Protein Without Complication"], world: "Stronger Every Week", worldSummary: "Progressive programs, form reviews, recovery sessions, and a supportive training community." },
  { first: "Priya", last: "Nair", username: "priyawellness", category: "Psychology", city: "Bengaluru", country: "India", color: "9333ea", bio: "Mindfulness teacher exploring nervous-system care, rest, and grounded personal growth.", quote: "Rest is a skill, not a reward.", seen: ["A Five-Minute Nervous System Reset", "Listen Before You Fix"], world: "Soft Strength", worldSummary: "Meditations, reflection circles, gentle challenges, and tools for sustainable emotional wellbeing." },
  { first: "Lucas", last: "Reed", username: "lucasframes", category: "Fashion", city: "New York", country: "United States", color: "ea580c", bio: "Editorial model and photographer sharing visual storytelling from both sides of the lens.", quote: "The strongest image still feels human.", seen: ["Find Your Best Natural Light", "Build a Model Portfolio That Speaks"], world: "The Frame Society", worldSummary: "Editorial studies, portfolio reviews, lighting breakdowns, and monthly creative briefs." },
  { first: "Amara", last: "Okafor", username: "amarafinance", category: "Business", city: "Lagos", country: "Nigeria", color: "16a34a", bio: "Founder and finance mentor teaching creators to price, plan, and build resilient businesses.", quote: "Revenue feels better when the system is healthy.", seen: ["Price Your Creative Work", "A Cash-Flow Ritual for Founders"], world: "Creator Finance Circle", worldSummary: "Pricing clinics, cash-flow systems, business reviews, and resources made for independent creators." },
  { first: "Kenji", last: "Sato", username: "kenjimoves", category: "Fitness", city: "Tokyo", country: "Japan", color: "0891b2", bio: "Mobility and performance coach helping busy people move well with less pain and more freedom.", quote: "Movement quality changes everything around it.", seen: ["Ten Minutes for Better Hips", "Recover Like Training Matters"], world: "Move Better Studio", worldSummary: "Mobility plans, technique breakdowns, recovery protocols, and live movement sessions." },
  { first: "Elena", last: "Petrova", username: "elenainsight", category: "Psychology", city: "Berlin", country: "Germany", color: "8b5cf6", bio: "Behavior researcher sharing practical tools for self-awareness, communication, and emotional resilience.", quote: "Curiosity creates room for change.", seen: ["Understand Your Stress Signals", "A Better Way to Handle Conflict"], world: "The Reflection Practice", worldSummary: "Guided psychology sessions, reflection prompts, and live conversations for meaningful personal growth." },
  { first: "Marcus", last: "Lee", username: "marcusdaily", category: "Lifestyle", city: "Singapore", country: "Singapore", color: "059669", bio: "Lifestyle creator exploring intentional routines, modern city life, travel, and thoughtful simplicity.", quote: "Make space for what makes the day memorable.", seen: ["Design a Calmer Week", "The Art of a Solo City Day"], world: "Living With Intention", worldSummary: "Weekly lifestyle edits, city guides, home rituals, and community challenges for intentional living." },
  { first: "Zara", last: "Bennett", username: "zarainframe", category: "Fashion", city: "Paris", country: "France", color: "e11d48", bio: "Fashion model and stylist sharing editorial craft, personal style, and confidence beyond trends.", quote: "Wear the story before the clothes.", seen: ["Build a Signature Look", "Confidence Before the Camera"], world: "The Style Atelier", worldSummary: "Styling workshops, editorial diaries, wardrobe critiques, and behind-the-scenes fashion stories." },
  { first: "Daniel", last: "Kim", username: "danielmoney", category: "Business", city: "Seoul", country: "South Korea", color: "d97706", bio: "Finance strategist helping young professionals invest, negotiate, and make confident money decisions.", quote: "A simple system beats constant financial stress.", seen: ["Investing Without the Noise", "Negotiate Your Next Raise"], world: "The Wealth Workshop", worldSummary: "Investing sessions, negotiation practice, money templates, and monthly financial planning rooms." },
  { first: "Nia", last: "Campbell", username: "niacodesai", category: "Tech", city: "San Francisco", country: "United States", color: "0284c7", bio: "Machine-learning engineer building approachable AI products and teaching people how they actually work.", quote: "The best technology makes people more capable.", seen: ["AI Agents in Plain Language", "Prototype an AI Product This Weekend"], world: "Human-Centered AI", worldSummary: "AI product studios, technical walkthroughs, build challenges, and conversations about responsible design." },
  { first: "Rafael", last: "Costa", username: "rafaelstrength", category: "Fitness", city: "Lisbon", country: "Portugal", color: "ef4444", bio: "Hybrid coach combining strength, endurance, and recovery for energetic everyday performance.", quote: "Fitness should give more life than it takes.", seen: ["Your First Hybrid Training Week", "Recovery Is Part of the Program"], world: "Everyday Athlete Club", worldSummary: "Hybrid programs, recovery plans, technique reviews, and monthly performance challenges." },
  { first: "Chloe", last: "Martin", username: "chloemindful", category: "Psychology", city: "Melbourne", country: "Australia", color: "a855f7", bio: "Counsellor and educator making relationships, attachment, and emotional regulation easier to understand.", quote: "Safety grows through small moments of repair.", seen: ["Recognize Your Attachment Pattern", "How to Repair After an Argument"], world: "Connected Within", worldSummary: "Relationship tools, guided conversations, attachment education, and supportive community reflection." },
  { first: "Arjun", last: "Mehta", username: "arjunmodernlife", category: "Lifestyle", city: "Mumbai", country: "India", color: "0d9488", bio: "Creative entrepreneur documenting design, food, travel, and better systems for a busy modern life.", quote: "Good systems leave more room for living.", seen: ["Reset a Busy Weekend", "Create a Personal City Guide"], world: "The Modern Life Project", worldSummary: "Design inspiration, local discoveries, productivity resets, and monthly creative lifestyle projects." },
  { first: "Hana", last: "Mori", username: "hanastyled", category: "Fashion", city: "Kyoto", country: "Japan", color: "f43f5e", bio: "Model and visual artist blending contemporary fashion with quiet, timeless storytelling.", quote: "Elegance is attention without noise.", seen: ["Move Naturally on Camera", "Style With Shape and Texture"], world: "Quiet Editorial", worldSummary: "Visual studies, styling lessons, modeling direction, and intimate editorial production diaries." },
  { first: "Victor", last: "Mensah", username: "victorbuilds", category: "Tech", city: "Accra", country: "Ghana", color: "2563eb", bio: "AI founder teaching practical automation, product thinking, and how to build technology that earns trust.", quote: "Build the smallest useful truth first.", seen: ["Automate One Hour of Your Week", "Validate an AI Idea Before Coding"], world: "The Practical AI Foundry", worldSummary: "Automation recipes, product teardown sessions, founder office hours, and collaborative AI builds." },
];

const comments = ["This made the idea click for me.", "Exactly what I needed today.", "Saving this for my weekly reset.", "Clear, practical, and beautifully explained.", "I tried this and noticed a difference immediately."];
const wallCopy = [
  (c) => ({ context: "RIGHT_NOW", text: `A small reminder from ${c.first}: consistency is allowed to look quiet. What is one promise you can keep today?` }),
  (c) => ({ context: c.category === "Fitness" ? "FITNESS" : c.category === "Lifestyle" ? "LIFESTYLE" : "WELLNESS", text: `Today in ${c.city}: testing a new idea for the community and keeping the useful parts simple. More soon.` }),
  (c) => ({ context: "COFFEE", text: `Coffee, notes, and a fresh outline for this week's ${c.world} session. What should we explore together?` }),
];

const creatorStatuses = [
  { label: "📚 Reading", color: "#B092FF" },
  { label: "🌅 Morning person", color: "#F6D365" },
  { label: "✍️ New Seen soon", color: "#F472B6" },
  { label: "🎧 Deep work", color: "#9CCBFF" },
  { label: "💬 Replying to everyone", color: "#6ECF97" },
  { label: "💪 At the gym", color: "#F3A85E" },
  { label: "📖 Writing a chapter", color: "#A7D8C4" },
  { label: "✍️ New Seen soon", color: "#FB923C" },
  { label: "🌍 My World is open", color: "#4ADE80" },
  { label: "🎾 Tennis?", color: "#6ECF97" },
  { label: "👁 At seen", color: "#9CCBFF" },
  { label: "☕ Coffee walk", color: "#C8A27A" },
  { label: "📖 Writing a chapter", color: "#FB7185" },
  { label: "🎧 Deep work", color: "#F6D365" },
  { label: "📞 Open for calls", color: "#60A5FA" },
  { label: "💪 At the gym", color: "#F87171" },
  { label: "💬 Replying to everyone", color: "#C084FC" },
  { label: "✈️ Traveling", color: "#B092FF" },
  { label: "✍️ New Seen soon", color: "#FDA4AF" },
  { label: "🌍 My World is open", color: "#93C5FD" },
];

function activeStatusFor(index) {
  const creatorStatus = creatorStatuses[index];
  return { emoji: "", label: creatorStatus.label, presetKey: "custom", isCustom: true, color: creatorStatus.color, startedAt: at(index / 4), expiresAt: null, isActive: true };
}

function objectId(key) {
  return new mongoose.Types.ObjectId(crypto.createHash("sha1").update(`${SOURCE}:${key}`).digest("hex").slice(0, 24));
}

function at(hoursAgo) {
  return new Date(Date.now() - hoursAgo * HOUR);
}

function imageUrl(c, variant, width = 1200, height = 800) {
  return `https://images.unsplash.com/photo-${variant}?auto=format&fit=crop&w=${width}&h=${height}&q=82`;
}

const photoIds = [
  "1494790108377-be9c29b29330", "1500648767791-00dcc994a43e", "1534528741775-53994a69daeb", "1507003211169-0a1dd7228f2d",
  "1531123897727-8f129e1688ce", "1506794778202-cad84cf45f1d", "1531746020798-e6953c6e8e04", "1501196354995-cbb51c65aaea",
  "1531123897727-8f129e1688ce", "1527980965255-d3b416303d12",
];
const coverIds = [
  "1499209974431-9dddcece7f88", "1494438639946-1ebd1d20bf85", "1529139574466-a303027c1d8b", "1554224155-8d04cb21cd6c",
  "1518770660439-4636190af475", "1517836357463-d25dfeac3438", "1506126613408-eca07ce68773", "1513364776144-60967b0f800f",
  "1556761175-b413da4baf72", "1571019613454-1cb2f99b2d8b",
];
const seenCoverVideos = [
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  "https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4",
];

function media(key, url, mediaType = "IMAGE") {
  return { assetId: `${SOURCE}-${key}`, resourceType: mediaType === "VIDEO" ? "video" : "image", mediaType, secureUrl: url, format: mediaType === "VIDEO" ? "mp4" : "jpg" };
}

function seenCoverFor(c, creatorIndex, seenIndex) {
  if ((creatorIndex + seenIndex) % 4 === 0) {
    return { ...media(`${c.username}-seen-${seenIndex}-cover`, seenCoverVideos[(creatorIndex + seenIndex) % seenCoverVideos.length], "VIDEO"), duration: 15, width: 1280, height: 720 };
  }
  return media(`${c.username}-seen-${seenIndex}-cover`, imageUrl(c, coverIds[(creatorIndex + seenIndex + 2) % coverIds.length]));
}

async function seedUser(c, index, passwordHash) {
  const id = objectId(`user:${c.username}`);
  const avatar = imageUrl(c, photoIds[index % photoIds.length], 500, 500);
  const now = new Date();
  await User.findOneAndUpdate({ _id: id }, { $set: {
    name: `${c.first} ${c.last}`, username: c.username, email: `${c.first.toLowerCase()}@gmail.com`, password: passwordHash,
    role: "fan", creatorApprovalStatus: "approved", avatar, isVerified: true, status: "active", lastSeenAt: at(index / 2),
    activeStatus: activeStatusFor(index),
    onboarding: { version: 1, status: "completed", currentStep: "completed", startedAt: at(24 * 60), welcomeCompleted: true, interestsCompleted: true, instinctsCompleted: true, peopleCompleted: true, checklistAcknowledged: true, skippedSteps: [], completedAt: at(24 * 58), skippedAt: null },
    onboardingChecklist: { watchedIntro: true, openedOrbit: true, openedStudio: true, createdFirstPost: true, sharedFirstStory: true, createdFirstWorld: true, followedFirstPeople: true, reactedToStory: true, visitedWorld: true, completedProfile: true, dismissedAt: now, completedAt: now, rewardGrantedAt: now },
  } }, { upsert: true, setDefaultsOnInsert: true });

  const commonProfile = { coverPhoto: imageUrl(c, coverIds[index % coverIds.length], 1600, 700), bio: c.bio, interests: [c.category, "Creativity", "Community"], city: c.city, country: c.country, orbitStatus: c.quote, profileVisibility: "public", preferredLanguage: "en", timezone: "UTC", privacySettings: { showOnlineStatus: true, showActivityStatus: true, showLocation: true, allowDiscovery: true, allowDirectMessages: true, allowMentions: true, allowTags: true, savedPlacesVisibility: "everyone", showMemberBadge: "everyone", orbitVisibility: "everyone" } };
  await FanProfile.findOneAndUpdate({ user: id }, { $set: { user: id, ...commonProfile } }, { upsert: true, setDefaultsOnInsert: true });
  await CreatorProfile.findOneAndUpdate({ user: id }, { $set: { user: id, ...commonProfile, category: c.category, categories: [c.category], orbitQuote: c.quote, monthlyPrice: 1.9 + index % 3, subscriptionPriceCents: 300, verificationStatus: "verified", messagingEnabled: true, directAccessEnabled: true, directAccessPriceStars: 100 + (index % 3) * 50, directCallEnabled: index % 3 === 0, directCallPriceStars: 300, directCallDurationMinutes: 5, freePreviewEnabled: true, socialLinks: [{ platform: "Instagram", url: `https://instagram.com/${c.username}` }] } }, { upsert: true, setDefaultsOnInsert: true });
  await Wallet.findOneAndUpdate({ user: id }, { $setOnInsert: { user: id, balance: 5000, bonusBalance: 5000, purchasedBalance: 0, earnedBalance: 0, currency: "STARS", ledgerActivatedAt: now, reconciliationStatus: "MATCHED" } }, { upsert: true, setDefaultsOnInsert: true });
  return { ...c, id, avatar };
}

function seenChapters(c, seenIndex) {
  const topic = c.seen[seenIndex];
  return [
    { title: "Start here", isPreview: true, blocks: [
      { type: "HIGHLIGHT", text: `${topic} starts with one honest observation, not a perfect plan.` },
      { type: "TEXT", text: `Notice what is happening without judging it. ${c.first} explains a simple way to turn awareness into a useful next step.` },
    ] },
    { title: "Try this today", isPreview: true, blocks: [
      { type: "KEY_POINT", text: "Choose the smallest action that is clear enough to repeat." },
      { type: "IMAGE", media: media(`${c.username}-seen-${seenIndex}-inside`, imageUrl(c, coverIds[(seenIndex + 3) % coverIds.length], 1200, 900)), metadata: { label: "A practical moment" } },
      { type: "TEXT", text: "Keep the experiment small, pay attention to the result, and adjust with curiosity rather than pressure." },
    ] },
  ];
}

function normalizeChapters(key, chapters) {
  return chapters.map((chapter, chapterIndex) => ({
    stableChapterId: `${SOURCE}-${key}-chapter-${chapterIndex + 1}`, order: chapterIndex, title: chapter.title, isPreview: chapter.isPreview,
    releaseMode: "IMMEDIATE", releaseAt: null,
    blocks: chapter.blocks.map((block, blockIndex) => ({ id: `${SOURCE}-${key}-block-${chapterIndex + 1}-${blockIndex + 1}`, order: blockIndex, ...block })),
  }));
}

async function seedPublication(c, key, input, publishedAt) {
  const id = objectId(`publication:${key}`);
  const chapters = normalizeChapters(key, input.chapters || []);
  const includedExperienceIds = input.includedExperienceIds || [];
  const metadata = { kind: input.kind, title: input.title, summary: input.summary, description: input.description, category: c.category, tags: input.tags, coverMedia: input.coverMedia, introMedia: input.introMedia, visibility: "PUBLIC", pricing: input.pricing, planet: input.planet, includedInWorld: Boolean(input.includedInWorld), includedExperienceIds, experiencePath: input.experiencePath || "", experienceLocation: input.experienceLocation || "", allowDownload: Boolean(input.allowDownload) };
  await Publication.findOneAndUpdate({ _id: id }, { $set: { creator: c.id, ...metadata, includedExperienceIds, previewPolicy: input.kind === "SEEN" ? "ALL_FREE" : "ONE_CHAPTER", status: "PUBLISHED", draftVersion: 1, submittedVersion: 1, publishedVersion: 1, statusVersion: 1, submittedSnapshot: { version: 1, metadata, chapters, frozenAt: publishedAt }, publishedSnapshot: { version: 1, metadata, chapters, frozenAt: publishedAt }, submittedAt: publishedAt, publishedAt, seedSource: SOURCE, seedKey: key, commentsEnabled: true, directAccessIncluded: true, worldFoundingCapacity: 250, worldSeatCapacity: 250, worldWaveSize: 100 } }, { upsert: true, setDefaultsOnInsert: true });
  await Chapter.deleteMany({ publication: id });
  if (chapters.length) await Chapter.insertMany(chapters.map((chapter) => ({ publication: id, ...chapter })));
  return id;
}

async function seedContent(c, index) {
  const wallIds = [];
  for (let i = 0; i < wallCopy.length; i += 1) {
    const id = objectId(`wall:${c.username}:${i}`);
    const copy = wallCopy[i](c);
    const createdAt = at(index * 2 + i * 9 + 2);
    const feedContext = { RIGHT_NOW: "Right now", FITNESS: "Fitness", LIFESTYLE: "Other", WELLNESS: "Advice", COFFEE: "Coffee" }[copy.context] || "Other";
    await FeedPost.findOneAndUpdate({ _id: id }, { $set: { author: c.id, text: copy.text, context: feedContext, location: `${c.city}, ${c.country}`, media: i === 1 ? [{ assetId: `${SOURCE}-${c.username}-wall-${i}`, url: imageUrl(c, coverIds[(index + i + 1) % coverIds.length]), type: "image", format: "jpg", mimeType: "image/jpeg", width: 1200, height: 800, sortOrder: 0 }] : [], visibility: "public", status: "published", deletedAt: null, publishedAt: createdAt, createdAt, updatedAt: createdAt, seedSource: SOURCE, seedKey: `${c.username}-wall-${i}`, reactions: [], comments: [], saves: [], views: [], shares: [], hiddenBy: [], reports: [], supportCount: 0, commentCount: 0, saveCount: 0, viewCount: 0, shareCount: 0 } }, { upsert: true, setDefaultsOnInsert: true, timestamps: false });
    await WallEngagement.deleteMany({ post: id });
    await WallPost.deleteOne({ _id: id });
    wallIds.push(id);
  }

  const seenIds = [];
  for (let i = 0; i < c.seen.length; i += 1) {
    const title = c.seen[i];
    const cover = seenCoverFor(c, index, i);
    seenIds.push(await seedPublication(c, `${c.username}-seen-${i}`, { kind: "SEEN", title, summary: `A clear, practical guide from ${c.first} with ideas you can use today.`, description: `${c.first} breaks ${title.toLowerCase()} into approachable steps, honest context, and a useful experiment.`, tags: [c.category.toLowerCase(), "practical", "showcase"], coverMedia: cover, pricing: { mode: "FREE", starsAmount: null, presetId: null }, planet: { slot: null, emoji: "", accent: `#${c.color}` }, chapters: seenChapters(c, i) }, at(index * 6 + i * 24 + 18)));
  }

  const experienceIds = [];
  const experienceNames = [`${c.category} Foundations`, `A Week With ${c.first}`];
  for (let i = 0; i < experienceNames.length; i += 1) {
    const title = experienceNames[i];
    const experienceCover = media(`${c.username}-experience-${i}-cover`, imageUrl(c, coverIds[(index + i + 7) % coverIds.length]));
    const chapters = [
      { title: "Welcome and orientation", isPreview: false, blocks: [
        { type: "VIDEO", media: media(`${c.username}-experience-${i}-video`, "https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4", "VIDEO") },
        { type: "TEXT", text: `${c.first} introduces the purpose of ${title} and the outcome you will build toward.` },
        { type: "LIST", text: "", metadata: { listItems: ["Choose a clear starting point", "Complete one focused practice", "Reflect and adjust"] } },
      ] },
      { title: "The guided practice", isPreview: false, blocks: [
        { type: "KEY_POINT", text: "Progress comes from a useful practice repeated with attention." },
        { type: "IMAGE", media: media(`${c.username}-experience-${i}-practice`, imageUrl(c, coverIds[(index + i + 3) % coverIds.length])) },
        { type: "POLL", metadata: { question: "Which part should we explore more deeply?", options: ["Mindset", "Technique", "Planning", "Consistency"], resultsVisibility: "SUBSCRIBERS" } },
      ] },
      { title: "Your next seven days", isPreview: false, blocks: [
        { type: "HIGHLIGHT", text: "Make the next step small enough to begin today." },
        { type: "LINK", label: "Continue the conversation in the community", url: "https://onlyme.example/community" },
      ] },
    ];
    experienceIds.push(await seedPublication(c, `${c.username}-experience-${i}`, { kind: "EXPERIENCE", title, summary: `A guided ${c.category.toLowerCase()} experience designed by ${c.first}.`, description: `Three focused chapters combining explanation, visual guidance, reflection, and an actionable seven-day plan.`, tags: [c.category.toLowerCase(), "guided", "experience"], coverMedia: experienceCover, introMedia: i === 0 ? media(`${c.username}-experience-${i}-intro`, "https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4", "VIDEO") : undefined, pricing: { mode: "ONE_TIME", starsAmount: [90, 190][i], presetId: `experience-${[90, 190][i]}` }, planet: { slot: null, emoji: "", accent: `#${c.color}` }, experiencePath: `${c.category} / ${i === 0 ? "Foundation" : "Practice"}`, experienceLocation: i === 0 ? "Online" : c.city, allowDownload: i === 1, includedInWorld: i === 0, chapters }, at(index * 8 + i * 24 + 48)));
  }

  const worldCover = media(`${c.username}-world-cover`, imageUrl(c, coverIds[(index + 5) % coverIds.length]));
  const preview = [{ title: `Welcome to ${c.world}`, isPreview: true, blocks: [
    { type: "IMAGE", media: worldCover, metadata: { label: "Member preview", storyPreview: true } },
    { type: "TEXT", text: `${c.worldSummary} New member sessions arrive every week.` },
  ] }];
  const worldId = await seedPublication(c, `${c.username}-premium-world`, { kind: "PREMIUM_WORLD", title: c.world, summary: c.worldSummary, description: `${c.worldSummary} Join ${c.first} and a thoughtful community for new member-only releases every week.`, tags: [c.category.toLowerCase(), "community", "premium"], coverMedia: worldCover, introMedia: index % 2 ? undefined : media(`${c.username}-world-intro`, "https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4", "VIDEO"), pricing: { mode: "MONTHLY", starsAmount: [90, 190, 290][index % 3], presetId: `monthly-${[90, 190, 290][index % 3]}` }, planet: { slot: "PREMIUM", emoji: ["🧠", "🌿", "✨", "📈", "🤖", "💪"][index % 6], faceEmoji: "", accent: `#${c.color}` }, includedExperienceIds: [experienceIds[0]], chapters: preview }, at(index * 8 + 72));

  const dreamId = objectId(`dream:${c.username}`);
  const dreamTitle = [`Open a creative studio`, `Publish a field guide`, `Host a community retreat`, `Build a learning space`][index % 4];
  await Dream.findOneAndUpdate({ _id: dreamId }, { $set: { creator: c.id, emoji: ["✨", "🎙️", "🌍", "📚"][index % 4], title: dreamTitle, reason: `To create a lasting home for ${c.category.toLowerCase()} ideas and bring this community together.`, photo: { assetId: `${SOURCE}-${c.username}-dream`, url: imageUrl(c, coverIds[(index + 8) % coverIds.length]), resourceType: "image" }, goalStars: [900, 1500, 2500, 5000][index % 4], receivedStars: 0, supporterCount: 0, status: "ACTIVE", version: 1 } }, { upsert: true, setDefaultsOnInsert: true });
  await OrbitDream.findOneAndUpdate({ user: c.id, status: "active" }, { $set: { user: c.id, title: dreamTitle, emoji: ["✨", "🎙️", "🌍", "📚"][index % 4], status: "active", visibility: "public", currentAmount: 0, goalAmount: [900, 1500, 2500, 5000][index % 4], supporterCount: 0 } }, { upsert: true, setDefaultsOnInsert: true });

  const storyIds = [];
  for (let i = 0; i < 2; i += 1) {
    const id = objectId(`story:${c.username}:${i}`);
    const createdAt = at(index + i * 2 + 0.25);
    const isVideo = (index + i) % 4 === 0;
    await Story.findOneAndUpdate({ _id: id }, { $set: { creator: c.id, caption: i === 0 ? `A quick moment from ${c.city} ✨` : `New inside ${c.world} today`, image: { assetId: `${SOURCE}-${c.username}-story-${i}`, url: isVideo ? "https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4" : imageUrl(c, coverIds[(index + i + 4) % coverIds.length], 900, 1600), resourceType: isVideo ? "video" : "image" }, mediaType: isVideo ? "video" : "image", sourceType: i === 0 ? "original" : "seen", sourceSeen: i === 0 ? null : seenIds[0], duration: isVideo ? 12 : 5, audience: "everyone", allowReactions: true, allowReplies: true, allowSharing: true, createdAt, updatedAt: createdAt, expiresAt: new Date(Date.now() + (22 - i) * HOUR) } }, { upsert: true, setDefaultsOnInsert: true, timestamps: false });
    storyIds.push(id);
  }

  await ProfileMedia.deleteMany({ user: c.id, assetId: { $regex: `^${SOURCE}` } });
  await ProfileMedia.insertMany([
    { user: c.id, type: "image", url: imageUrl(c, coverIds[(index + 6) % coverIds.length]), thumbnailUrl: imageUrl(c, coverIds[(index + 6) % coverIds.length], 400, 400), assetId: `${SOURCE}-${c.username}-profile-1`, resourceType: "image", mimeType: "image/jpeg", format: "jpg", width: 1200, height: 800, caption: "A moment from this week's work", sortOrder: 2, sourceType: "direct" },
    { user: c.id, type: "image", url: imageUrl(c, coverIds[(index + 7) % coverIds.length]), thumbnailUrl: imageUrl(c, coverIds[(index + 7) % coverIds.length], 400, 400), assetId: `${SOURCE}-${c.username}-profile-2`, resourceType: "image", mimeType: "image/jpeg", format: "jpg", width: 1200, height: 800, caption: `Inside ${c.world}`, sortOrder: 1, sourceType: "direct" },
  ]);
  return { ...c, wallIds, seenIds, experienceIds, worldId, dreamId, storyIds };
}

async function seedInteractions(rows) {
  const followOperations = rows.flatMap((actor, actorIndex) => Array.from({ length: rows.length - 1 }, (_, index) => index + 1).map((offset) => {
    const target = rows[(actorIndex + offset) % rows.length];
    return { updateOne: { filter: { actor: actor.id, target: target.id, type: "FOLLOW" }, update: { $set: { actor: actor.id, target: target.id, type: "FOLLOW", createdAt: at(actorIndex * 2 + offset + 12), updatedAt: at(actorIndex * 2 + offset + 12) } }, upsert: true } };
  }));
  await ProfileRelationship.bulkWrite(followOperations, { ordered: true });

  for (let ownerIndex = 0; ownerIndex < rows.length; ownerIndex += 1) {
    const owner = rows[ownerIndex];
    const feedEngagement = new Map(owner.wallIds.map((id) => [String(id), { reactions: [], comments: [], saves: [], views: [] }]));
    for (let offset = 1; offset <= 4; offset += 1) {
      const actor = rows[(ownerIndex + offset) % rows.length];
      const post = owner.wallIds[offset % owner.wallIds.length];
      const seen = owner.seenIds[offset % owner.seenIds.length];
      const story = owner.storyIds[offset % owner.storyIds.length];
      const stamp = at(ownerIndex * 2 + offset + 1);
      const postEngagement = feedEngagement.get(String(post));
      postEngagement.reactions.push({ user: actor.id, reaction: ["love", "care", "wow", "like"][offset - 1], createdAt: stamp, updatedAt: stamp });
      postEngagement.views.push({ user: actor.id, viewedAt: stamp });
      await SeenEngagement.findOneAndUpdate({ publication: seen, user: actor.id, type: "REACTION" }, { $set: { publication: seen, user: actor.id, type: "REACTION", reaction: ["LOVE", "INSIGHTFUL", "CLAP", "FIRE"][offset - 1], createdAt: stamp, updatedAt: stamp } }, { upsert: true, timestamps: false });
      await StoryEngagement.findOneAndUpdate({ story, fan: actor.id }, { $set: { story, fan: actor.id, viewedAt: stamp, reaction: ["❤️", "🔥", "👏", "✨"][offset - 1], createdAt: stamp, updatedAt: stamp } }, { upsert: true, timestamps: false });
      if (offset <= 2) {
        postEngagement.comments.push({ _id: objectId(`wall-comment:${post}:${actor.id}`), user: actor.id, text: comments[(ownerIndex + offset) % comments.length], deletedAt: null, archivedAt: null, createdAt: stamp, updatedAt: stamp });
        await SeenEngagement.findOneAndUpdate({ _id: objectId(`seen-comment:${seen}:${actor.id}`) }, { $set: { publication: seen, user: actor.id, type: "COMMENT", text: comments[(ownerIndex + offset + 2) % comments.length], createdAt: stamp, updatedAt: stamp } }, { upsert: true, timestamps: false });
      }
      if (offset === 3) {
        postEngagement.saves.push({ user: actor.id, createdAt: stamp, updatedAt: stamp });
        await SeenEngagement.findOneAndUpdate({ publication: seen, user: actor.id, type: "SAVE" }, { $set: { publication: seen, user: actor.id, type: "SAVE", createdAt: stamp, updatedAt: stamp } }, { upsert: true, timestamps: false });
      }
      if (offset <= 2) {
        const experience = owner.experienceIds[(offset - 1) % owner.experienceIds.length];
        await ExperienceAccessRequest.findOneAndUpdate({ publication: experience, requester: actor.id }, { $set: { publication: experience, creator: owner.id, requester: actor.id, status: offset === 1 ? "APPROVED" : "PENDING", decidedAt: offset === 1 ? stamp : null, createdAt: stamp, updatedAt: stamp } }, { upsert: true, setDefaultsOnInsert: true, timestamps: false });
      }
    }
    await Promise.all(owner.wallIds.map((postId) => {
      const postIndex = owner.wallIds.findIndex((id) => String(id) === String(postId));
      const actors = rows.filter((row) => String(row.id) !== String(owner.id));
      const reactions = actors.map((actor, actorIndex) => ({ user: actor.id, reaction: ["love", "care", "wow", "like", "useful", "fire", "clap", "strong", "pray"][(ownerIndex + postIndex + actorIndex) % 9], createdAt: at(ownerIndex + postIndex + actorIndex + 1), updatedAt: at(ownerIndex + postIndex + actorIndex + 1) }));
      const commentsForPost = actors.slice(0, 8).map((actor, actorIndex) => ({ _id: objectId(`wall-comment:${postId}:${actor.id}`), user: actor.id, text: comments[(ownerIndex + postIndex + actorIndex) % comments.length], deletedAt: null, archivedAt: null, createdAt: at(ownerIndex + postIndex + actorIndex + 1), updatedAt: at(ownerIndex + postIndex + actorIndex + 1) }));
      const saves = actors.slice(2, 7).map((actor, actorIndex) => ({ user: actor.id, createdAt: at(ownerIndex + postIndex + actorIndex + 2), updatedAt: at(ownerIndex + postIndex + actorIndex + 2) }));
      const views = actors.map((actor, actorIndex) => ({ user: actor.id, viewedAt: at(ownerIndex + postIndex + actorIndex + 0.5) }));
      const shareActors = Array.from({ length: 3 }, (_, offset) => actors[(ownerIndex + postIndex + offset) % actors.length]);
      const shares = shareActors.map((actor, actorIndex) => ({ user: actor.id, caption: ["Worth sharing with everyone.", "Keeping this close — beautifully said.", "A useful idea for today."][actorIndex], createdAt: at(ownerIndex + postIndex + actorIndex + 1), updatedAt: at(ownerIndex + postIndex + actorIndex + 1) }));
      return FeedPost.updateOne({ _id: postId }, { $set: { reactions, comments: commentsForPost, saves, views, shares, supportCount: reactions.length, commentCount: commentsForPost.length, saveCount: saves.length, viewCount: views.length, shareCount: shares.length } }, { timestamps: false });
    }));

    await SeenEngagement.deleteMany({ publication: { $in: owner.seenIds }, user: { $in: rows.map((row) => row.id) } });
    const seenRows = [];
    for (const [seenIndex, publication] of owner.seenIds.entries()) {
      const actors = rows.filter((row) => String(row.id) !== String(owner.id));
      const shareActorIds = new Set(Array.from({ length: 3 }, (_, offset) => String(actors[(ownerIndex + seenIndex + offset) % actors.length].id)));
      actors.forEach((actor, actorIndex) => {
        const stamp = at(ownerIndex + seenIndex * 2 + actorIndex + 1);
        seenRows.push({ publication, user: actor.id, type: "REACTION", reaction: ["LOVE", "INSIGHTFUL", "CLAP", "FIRE", "WOW", "HUNDRED", "SPARKLES", "STRONG", "PRAY"][(ownerIndex + actorIndex) % 9], createdAt: stamp, updatedAt: stamp });
        if (actorIndex < 8) seenRows.push({ _id: objectId(`seen-comment:${publication}:${actor.id}`), publication, user: actor.id, type: "COMMENT", text: comments[(ownerIndex + seenIndex + actorIndex) % comments.length], createdAt: stamp, updatedAt: stamp });
        if (actorIndex < 6) seenRows.push({ publication, user: actor.id, type: "SAVE", createdAt: stamp, updatedAt: stamp });
        if (shareActorIds.has(String(actor.id))) seenRows.push({ publication, user: actor.id, type: "SHARE", reaction: "LIKE", text: ["This deserves a wider audience.", "Sharing this thoughtful Seen.", "A strong idea worth revisiting."][(ownerIndex + seenIndex + actorIndex) % 3], createdAt: stamp, updatedAt: stamp });
      });
    }
    await SeenEngagement.insertMany(seenRows);
    await Notification.findOneAndUpdate({ dedupeKey: `${SOURCE}:welcome:${owner.id}` }, { $set: { user: owner.id, type: "creator_showcase_ready", title: "Your creator showcase is ready", message: `Your profile, Seens, Stories, and ${owner.world} are live.`, severity: "info", priority: 10, dedupeKey: `${SOURCE}:welcome:${owner.id}`, createdAt: at(ownerIndex + 30), updatedAt: at(ownerIndex + 30) } }, { upsert: true, timestamps: false });
  }
}

async function seedPurchases(rows) {
  const users = await User.find({ _id: { $in: rows.map((row) => row.id) } });
  const byId = new Map(users.map((user) => [String(user._id), user]));
  let experiencePurchases = 0;
  let premiumMemberships = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const buyerRow = rows[index];
    const buyer = byId.get(String(buyerRow.id));
    const experienceOwner = rows[(index + 1) % rows.length];
    const worldOwner = rows[(index + 2) % rows.length];
    await purchaseWorld({ user: buyer, publicationId: experienceOwner.experienceIds[1], key: `${SOURCE}-experience-purchase-${buyerRow.username}-${experienceOwner.username}` });
    experiencePurchases += 1;
    await joinPremium({ user: buyer, publicationId: worldOwner.worldId, key: `${SOURCE}-premium-join-${buyerRow.username}-${worldOwner.username}` });
    premiumMemberships += 1;
  }
  return { experiencePurchases, premiumMemberships };
}

function invokeController(handler, req) {
  const io = { to() { return this; }, emit() {} };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve(payload); return this; },
    };
    handler({ query: {}, body: {}, app: { get: () => io }, ...req }, res, reject);
  });
}

async function seedGifts(rows) {
  const users = await User.find({ _id: { $in: rows.map((row) => row.id) } });
  const byId = new Map(users.map((user) => [String(user._id), user]));
  let dreamGiftCount = 0;
  let directGiftCount = 0;
  let storyGiftCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const senderRow = rows[index];
    const sender = byId.get(String(senderRow.id));
    const dreamRecipient = rows[(index + 1) % rows.length];
    const directRecipient = rows[(index + 2) % rows.length];
    const storyRecipient = rows[(index + 3) % rows.length];

    const dreamGifts = await giftsForRecipient(dreamRecipient.id);
    const directGifts = await giftsForRecipient(directRecipient.id);
    const storyGifts = await giftsForRecipient(storyRecipient.id);
    if (!dreamGifts.length || !directGifts.length || !storyGifts.length) continue;

    await sendDreamGift({
      user: sender,
      dreamId: dreamRecipient.dreamId,
      giftKey: String(dreamGifts[index % Math.min(4, dreamGifts.length)]._id),
      privateSupport: index % 4 === 0,
      key: `${SOURCE}-dream-${senderRow.username}-${dreamRecipient.username}`,
    });
    dreamGiftCount += 1;

    await invokeController(sendChatGift, {
      user: sender,
      params: { userId: String(directRecipient.id) },
      body: { giftId: String(directGifts[(index + 1) % Math.min(5, directGifts.length)]._id), sourceType: "DIRECT", message: `A little support from ${senderRow.first} ✨`, visibility: "EVERYONE", idempotencyKey: `${SOURCE}-direct-${senderRow.username}-${directRecipient.username}` },
    });
    directGiftCount += 1;

    await invokeController(sendChatGift, {
      user: sender,
      params: { userId: String(storyRecipient.id) },
      body: { giftId: String(storyGifts[(index + 2) % Math.min(6, storyGifts.length)]._id), sourceType: "STORY", message: `Loved this story — ${senderRow.first}`, visibility: index % 3 === 0 ? "RECIPIENT_ONLY" : "EVERYONE", idempotencyKey: `${SOURCE}-story-${senderRow.username}-${storyRecipient.username}` },
    });
    storyGiftCount += 1;
  }
  return { dreamGiftCount, directGiftCount, storyGiftCount };
}

async function seed() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed client showcase data while NODE_ENV=production.");
  await connectDb();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const accounts = [];
  for (const [index, creator] of creators.entries()) accounts.push(await seedUser(creator, index, passwordHash));
  const rows = [];
  for (const [index, account] of accounts.entries()) rows.push(await seedContent(account, index));
  await seedInteractions(rows);
  const giftCounts = await seedGifts(rows);
  const purchaseCounts = await seedPurchases(rows);
  console.table(rows.map((row) => ({ name: `${row.first} ${row.last}`, category: row.category, email: `${row.first.toLowerCase()}@gmail.com`, password: PASSWORD, username: row.username })));
  console.log(`Seeded ${rows.length} approved unified creators, ${rows.length * (rows.length - 1)} mutual follow edges, ${rows.length * 3} Wall posts, ${rows.length * 2} Seens, ${rows.length} Premium Worlds, ${rows.length * 2} Experiences, ${rows.length} Dreams, ${rows.length * 2} active Stories, ${giftCounts.dreamGiftCount} Dream gifts, ${giftCounts.directGiftCount} Direct gifts, ${giftCounts.storyGiftCount} Story gifts, ${purchaseCounts.experiencePurchases} Experience purchases, ${purchaseCounts.premiumMemberships} Premium World memberships, profile media, access requests, reactions, comments, saves, reposts, views, and Activity records.`);
}

async function seedStatusesOnly() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed client showcase data while NODE_ENV=production.");
  await connectDb();
  for (const [index, creator] of creators.entries()) {
    await User.updateOne({ _id: objectId(`user:${creator.username}`) }, { $set: { activeStatus: activeStatusFor(index) } });
  }
  console.table(creators.map((creator, index) => ({ creator: `${creator.first} ${creator.last}`, status: creatorStatuses[index].label })));
  console.log(`Updated profile statuses for ${creators.length} showcase creators.`);
}

async function seedSeenCoversOnly() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed client showcase data while NODE_ENV=production.");
  await connectDb();
  let videoCount = 0;
  for (const [creatorIndex, creator] of creators.entries()) {
    for (let seenIndex = 0; seenIndex < creator.seen.length; seenIndex += 1) {
      const coverMedia = seenCoverFor(creator, creatorIndex, seenIndex);
      if (coverMedia.mediaType === "VIDEO") videoCount += 1;
      await Publication.updateOne(
        { _id: objectId(`publication:${creator.username}-seen-${seenIndex}`), kind: "SEEN" },
        { $set: { coverMedia, "submittedSnapshot.metadata.coverMedia": coverMedia, "publishedSnapshot.metadata.coverMedia": coverMedia } },
      );
    }
  }
  console.log(`Updated 40 showcase Seen covers: ${videoCount} videos and ${40 - videoCount} images.`);
}

async function seedGroupedActivitiesOnly() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed client showcase data while NODE_ENV=production.");
  await connectDb();
  const rows = creators.map((creator) => ({
    ...creator,
    id: objectId(`user:${creator.username}`),
    seenId: objectId(`publication:${creator.username}-seen-0`),
    wallId: objectId(`wall:${creator.username}:0`),
  }));

  for (const [ownerIndex, owner] of rows.entries()) {
    const actors = Array.from({ length: 4 }, (_, offset) => rows[(ownerIndex + offset + 1) % rows.length]);
    for (const [actorIndex, actor] of actors.entries()) {
      const stamp = new Date(Date.now() - (ownerIndex * 4 + actorIndex) * 30_000);
      await SeenEngagement.findOneAndUpdate(
        { publication: owner.seenId, user: actor.id, type: "REACTION" },
        { $set: { publication: owner.seenId, user: actor.id, type: "REACTION", reaction: ["LOVE", "FIRE", "CLAP", "WOW"][actorIndex], createdAt: stamp, updatedAt: stamp } },
        { upsert: true, timestamps: false },
      );
      await SeenEngagement.findOneAndUpdate(
        { publication: owner.seenId, user: actor.id, type: "SAVE" },
        { $set: { publication: owner.seenId, user: actor.id, type: "SAVE", createdAt: stamp, updatedAt: stamp } },
        { upsert: true, timestamps: false },
      );
      await SeenEngagement.findOneAndUpdate(
        { publication: owner.seenId, user: actor.id, type: "SHARE", reaction: "LIKE" },
        { $set: { publication: owner.seenId, user: actor.id, type: "SHARE", reaction: "LIKE", text: `Sharing ${owner.first}'s Seen with my community.`, createdAt: stamp, updatedAt: stamp } },
        { upsert: true, timestamps: false },
      );
      await SeenEngagement.findOneAndUpdate(
        { _id: objectId(`grouped-seen-comment:${owner.seenId}:${actor.id}`) },
        { $set: { publication: owner.seenId, user: actor.id, type: "COMMENT", text: comments[(ownerIndex + actorIndex) % comments.length], createdAt: stamp, updatedAt: stamp } },
        { upsert: true, timestamps: false },
      );
    }

    const post = await FeedPost.findById(owner.wallId).lean();
    if (!post) continue;
    const actorIds = new Set(actors.map((actor) => String(actor.id)));
    const reactions = (post.reactions || []).filter((row) => !actorIds.has(String(row.user)));
    const wallComments = (post.comments || []).filter((row) => !actorIds.has(String(row.user)));
    const saves = (post.saves || []).filter((row) => !actorIds.has(String(row.user)));
    actors.forEach((actor, actorIndex) => {
      const stamp = new Date(Date.now() - (ownerIndex * 4 + actorIndex) * 30_000);
      reactions.push({ user: actor.id, reaction: ["love", "fire", "clap", "wow"][actorIndex], createdAt: stamp, updatedAt: stamp });
      wallComments.push({ _id: objectId(`grouped-wall-comment:${owner.wallId}:${actor.id}`), user: actor.id, text: comments[(ownerIndex + actorIndex + 1) % comments.length], deletedAt: null, archivedAt: null, createdAt: stamp, updatedAt: stamp });
      saves.push({ user: actor.id, createdAt: stamp, updatedAt: stamp });
    });
    await FeedPost.updateOne(
      { _id: owner.wallId },
      { $set: { reactions, comments: wallComments, saves, supportCount: reactions.length, commentCount: wallComments.filter((row) => !row.deletedAt).length, saveCount: saves.length, updatedAt: new Date() } },
      { timestamps: false },
    );
  }
  console.log(`Added fresh grouped Seen and note activities for ${rows.length} showcase creators using four actors per target.`);
}

async function seedWithdrawalBalancesOnly() {
  if (env.nodeEnv === "production") throw new Error("Refusing to seed client showcase data while NODE_ENV=production.");
  await connectDb();
  const starsPerUsd = await getStarExchangeRate();
  const amount = 35 * starsPerUsd;
  let credited = 0;
  for (const [index, creator] of creators.entries()) {
    const userId = objectId(`user:${creator.username}`);
    const commandId = objectId(`withdrawal-demo-v2-command:${creator.username}`);
    const entryId = objectId(`withdrawal-demo-v2-entry:${creator.username}`);
    if (await StarsLedgerEntry.exists({ _id: entryId })) continue;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const wallet = await Wallet.findOneAndUpdate(
          { user: userId },
          { $inc: { balance: amount, earnedBalance: amount, version: 1 }, $set: { reconciliationStatus: "MATCHED" } },
          { new: true, session, runValidators: true },
        );
        if (!wallet) throw new Error(`Wallet missing for ${creator.username}`);
        await FinancialCommand.create([{
          _id: commandId, user: userId, commandType: "ADMIN_CREDIT", idempotencyKey: `${SOURCE}-withdrawal-demo-v2-${creator.username}`,
          requestFingerprint: crypto.createHash("sha256").update(`${SOURCE}:withdrawal:v2:${creator.username}:${amount}`).digest("hex"),
          status: "SUCCEEDED", processingLeaseExpiresAt: at(70 + index), resultReference: String(entryId), responseSnapshot: { seeded: true, starsAmount: amount }, completedAt: at(70 + index),
        }], { session });
        await StarsLedgerEntry.create([{
          _id: entryId, accountUser: userId, entryType: "MANUAL_ADJUSTMENT", entryRole: "SHOWCASE_CREATOR_INCOME", direction: "CREDIT",
          starsAmount: amount, signedAmount: amount, balanceAfter: wallet.balance, referenceType: "SHOWCASE_CREATOR_INCOME",
          referenceId: `${SOURCE}:withdrawal-v2:${creator.username}`, commandId, idempotencyKey: `${SOURCE}-withdrawal-demo-v2-${creator.username}`,
          metadata: { seeded: true, bucketCredit: { bonus: 0, purchased: 0, earned: amount }, starsPerUsd, usdAmount: 35 }, createdAt: at(72 + index),
        }], { session });
      });
      credited += 1;
    } finally {
      await session.endSession();
    }
  }
  console.log(`Added $35.00 (${amount} Stars at ${starsPerUsd} Stars/USD) of settled prototype withdrawal income to ${credited} new showcase wallets; all 20 remain idempotently funded.`);
}

(process.argv.includes("--statuses-only")
  ? seedStatusesOnly()
  : process.argv.includes("--seen-covers-only")
    ? seedSeenCoversOnly()
    : process.argv.includes("--grouped-activities-only")
      ? seedGroupedActivitiesOnly()
      : process.argv.includes("--withdrawal-balances-only")
        ? seedWithdrawalBalancesOnly()
      : seed())
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => mongoose.disconnect());
