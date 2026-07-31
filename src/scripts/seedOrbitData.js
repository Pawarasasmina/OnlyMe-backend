import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import Content from "../models/Content.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import OrbitCityProgress from "../models/OrbitCityProgress.js";
import OrbitDream from "../models/OrbitDream.js";
import User from "../models/User.js";

const creatorPassword = process.env.ORBIT_SEED_USER_PASSWORD || `${crypto.randomUUID()}Aa1!`;

const orbitCreators = [
  {
    name: "Lina Moreau",
    username: "lina",
    email: "orbit+lina@atseen.local",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80",
    cover: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=80",
    city: "Paris",
    country: "France",
    orbitStatus: "Wine tasting",
    categories: ["Travel", "Lifestyle", "Food", "Photography"],
    category: "Travel",
    bio: "Paris-based lifestyle creator sharing food, neighborhoods and golden-hour discoveries.",
    orbitQuote: "Book the 4:30 PM slot. You get daylight, sunset and the night view on one ticket.",
    content: {
      title: "Morning Walk in Paris",
      seedKey: "OrbitSeed:lina-world",
      legacyTopics: ["OrbitSeed:Paris Like a Local"],
      category: "Travel",
      image: "https://images.unsplash.com/photo-1508057198894-247b23fe5ade?auto=format&fit=crop&w=900&q=80",
      description: "A short guide to my favorite cafe and morning route.",
      body: "One morning through Paris: where the light starts, where the coffee is better, and the quiet route I send friends on first.",
    },
    dream: { title: "Learn Surfing", emoji: "🏄", goalAmount: 2500, currentAmount: 640, supporterCount: 18 },
  },
  {
    name: "Ethan Brooks",
    username: "ethan",
    email: "orbit+ethan@atseen.local",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&q=80",
    cover: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80",
    city: "Dubai",
    country: "UAE",
    orbitStatus: "At the gym",
    categories: ["Fitness", "Wellness", "Discipline", "Nutrition"],
    category: "Fitness",
    bio: "Fitness creator focused on practical routines, consistency and healthy living.",
    orbitQuote: "Small routines win because they leave you enough energy to show up again tomorrow.",
    content: {
      title: "8-Week Transformation",
      category: "Fitness",
      image: "https://images.unsplash.com/photo-1517963879433-6ad2b056d712?auto=format&fit=crop&w=900&q=80",
    },
    dream: { title: "Open a community training room", emoji: "💪", goalAmount: 6000, currentAmount: 2140, supporterCount: 41 },
  },
  {
    name: "Anna Kim",
    username: "anna",
    email: "orbit+anna@atseen.local",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=240&q=80",
    cover: "https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=1200&q=80",
    city: "Dubai",
    country: "UAE",
    orbitStatus: "Reading",
    categories: ["Books", "Family", "Psychology", "Lifestyle"],
    category: "Books",
    bio: "Reader, parent and lifestyle creator sharing useful everyday discoveries.",
    orbitQuote: "The best chapter is the one that makes your day feel a little more possible.",
    content: {
      title: "Books That Rebuilt Me",
      category: "Books",
      image: "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=900&q=80",
    },
  },
  {
    name: "Omar Hadid",
    username: "omar",
    email: "orbit+omar@atseen.local",
    verified: false,
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=240&q=80",
    cover: "https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?auto=format&fit=crop&w=1200&q=80",
    city: "Dubai",
    country: "UAE",
    orbitStatus: "Tennis?",
    categories: ["Tennis", "Fitness", "Events", "Community"],
    category: "Tennis",
    bio: "Dubai creator interested in tennis, community activities and local events.",
    orbitQuote: "One open court, two rackets, zero pressure.",
  },
  {
    name: "Mia Chen",
    username: "mia",
    email: "orbit+mia@atseen.local",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1512316609839-ce289d3eba0a?auto=format&fit=crop&w=240&q=80",
    cover: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=80",
    city: "Tokyo",
    country: "Japan",
    orbitStatus: "Just landed",
    categories: ["Travel", "Culture", "Lifestyle", "Photography"],
    category: "Travel",
    bio: "Travel creator sharing honest relocation stories and city discoveries.",
    orbitQuote: "Landing somewhere new gets easier when someone tells you where the quiet streets are.",
    content: {
      title: "Tokyo, One Way",
      category: "Travel",
      image: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=900&q=80",
    },
  },
  {
    name: "Sofia Rey",
    username: "sofia",
    email: "orbit+sofia@atseen.local",
    verified: false,
    avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=240&q=80",
    cover: "https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=1200&q=80",
    city: "Dubai",
    country: "UAE",
    orbitStatus: "Coffee walk",
    categories: ["Coffee", "Fashion", "Lifestyle", "Beauty"],
    category: "Lifestyle",
    bio: "Lifestyle creator sharing coffee spots, style and everyday city moments.",
    orbitQuote: "Coffee walk first, outfit notes second.",
  },
  {
    name: "James Cole",
    username: "james",
    email: "orbit+james@atseen.local",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=240&q=80",
    cover: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    city: "Dubai",
    country: "UAE",
    orbitStatus: "Building something big",
    categories: ["Business", "Startups", "Technology", "Productivity"],
    category: "Business",
    bio: "Founder and creator sharing practical lessons about building and scaling.",
    orbitQuote: "Build the thing you keep explaining at dinner.",
  },
];

const cityProgress = [
  { city: "Warsaw", country: "Poland", countryCode: "PL", currentCount: 785, targetCount: 1000, sortOrder: 1 },
  { city: "Paris", country: "France", countryCode: "FR", currentCount: 1873, targetCount: 2000, sortOrder: 2 },
  { city: "Barcelona", country: "Spain", countryCode: "ES", currentCount: 1105, targetCount: 2000, sortOrder: 3 },
];

function safeDbTarget() {
  try {
    const parsed = new URL(env.mongoUri);
    return {
      host: parsed.host,
      uriDatabase: parsed.pathname.replace(/^\//, "") || "(driver default)",
    };
  } catch {
    return { host: "(unavailable)", uriDatabase: "(unavailable)" };
  }
}

async function upsertCreator(seed) {
  let user = await User.findOne({ $or: [{ email: seed.email }, { username: seed.username }] });
  let created = false;

  if (!user) {
    user = await User.create({
      name: seed.name,
      username: seed.username,
      email: seed.email,
      password: creatorPassword,
      role: "creator",
      creatorApprovalStatus: "approved",
      avatar: seed.avatar,
      isVerified: seed.verified,
      status: "active",
    });
    created = true;
  } else {
    user.name = seed.name;
    user.username = seed.username;
    user.role = "creator";
    user.creatorApprovalStatus = "approved";
    user.avatar = seed.avatar;
    user.isVerified = seed.verified;
    user.status = "active";
    await user.save();
  }

  await CreatorProfile.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        bio: seed.bio,
        coverPhoto: seed.cover || "",
        orbitQuote: seed.orbitQuote || "",
        categories: seed.categories,
        category: seed.category,
        orbitStatus: seed.orbitStatus,
        city: seed.city,
        country: seed.country,
        profileVisibility: "public",
        verificationStatus: seed.verified ? "verified" : "not_submitted",
        messagingEnabled: true,
        ppmEnabled: seed.username === "james",
      },
      $setOnInsert: { user: user._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (seed.content) {
    const contentTopic = seed.content.seedKey || `OrbitSeed:${seed.content.title}`;
    const contentQuery = {
      creator: user._id,
      $or: [
        { topic: contentTopic },
        { topic: `OrbitSeed:${seed.content.title}` },
        ...(seed.content.legacyTopics || []).map((topic) => ({ topic })),
      ],
    };
    const thumbnail = seed.content.image ? {
      assetId: `orbit-seed-${seed.username}-${seed.content.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      resourceType: "image",
      mediaType: "IMAGE",
      secureUrl: seed.content.image,
      format: "jpg",
      isPrimary: true,
      uploadState: "VERIFIED",
    } : undefined;
    await Content.findOneAndUpdate(
      contentQuery,
      {
        $set: {
          creator: user._id,
          title: seed.content.title,
          topic: contentTopic,
          description: seed.content.description || `${seed.content.title} is seeded development content for Orbit recommendation context.`,
          contentType: seed.content.image ? "IMAGE" : "TEXT",
          thumbnail,
          media: thumbnail ? [thumbnail] : [],
          body: seed.content.body || "Seeded public World-style content used only for development recommendations.",
          category: seed.content.category,
          tags: seed.categories.map((item) => item.toLowerCase()),
          status: "PUBLISHED",
          accessLevel: "PUBLIC",
          publishedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  return { created, user };
}

async function updateExistingViewer() {
  const viewer = await User.findOne({
    $or: [{ username: "creator2" }, { email: "creator2@gmail.com" }],
  });

  if (!viewer) {
    if (process.env.ORBIT_SEED_CREATE_VIEWER !== "true") {
      return { updated: false, created: false, skipped: true };
    }

    if (!process.env.ORBIT_SEED_VIEWER_PASSWORD) {
      throw new Error("Set ORBIT_SEED_VIEWER_PASSWORD to create a new creator2 development login.");
    }

    const createdViewer = await User.create({
      name: "creator2",
      username: "creator2",
      email: "creator2@gmail.com",
      password: process.env.ORBIT_SEED_VIEWER_PASSWORD,
      role: "creator",
      creatorApprovalStatus: "approved",
      isVerified: true,
      status: "active",
    });

    await CreatorProfile.create({
      user: createdViewer._id,
      categories: ["Fitness", "Travel", "Business", "Lifestyle", "Tennis"],
      category: "Tennis",
      orbitStatus: "Tennis?",
      city: "Dubai",
      country: "UAE",
      profileVisibility: "public",
      verificationStatus: "verified",
      bio: "Creator profile configured for Orbit development testing.",
    });

    return { updated: true, created: true, skipped: false };
  }

  viewer.role = "creator";
  viewer.creatorApprovalStatus = "approved";
  viewer.isVerified = true;
  viewer.status = "active";
  await viewer.save();

  await CreatorProfile.findOneAndUpdate(
    { user: viewer._id },
    {
      $set: {
        categories: ["Fitness", "Travel", "Business", "Lifestyle", "Tennis"],
        category: "Tennis",
        orbitStatus: "Tennis?",
        city: "Dubai",
        country: "UAE",
        profileVisibility: "public",
        verificationStatus: "verified",
      },
      $setOnInsert: {
        user: viewer._id,
        bio: "Creator profile configured for Orbit development testing.",
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await FanProfile.deleteOne({ user: viewer._id });
  return { updated: true, created: false, skipped: false };
}

async function seedCityProgress() {
  for (const city of cityProgress) {
    await OrbitCityProgress.findOneAndUpdate(
      { city: city.city, country: city.country },
      {
        $set: {
          ...city,
          source: "seeded_launch_config",
          enabled: true,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
}

async function seedDreams(usersByUsername) {
  let count = 0;
  for (const creator of orbitCreators) {
    if (!creator.dream) continue;
    const user = usersByUsername.get(creator.username);
    if (!user) continue;
    await OrbitDream.findOneAndUpdate(
      { user: user._id, title: creator.dream.title },
      {
        $set: {
          user: user._id,
          ...creator.dream,
          status: "active",
          visibility: "public",
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    count += 1;
  }
  return count;
}

async function seed() {
  if (env.nodeEnv === "production") {
    throw new Error("Refusing to seed Orbit data while NODE_ENV=production.");
  }

  const target = safeDbTarget();
  console.log(`Seeding Orbit data for ${env.nodeEnv} database host=${target.host} uriDatabase=${target.uriDatabase}`);
  await connectDb();
  console.log(`Connected database name=${mongoose.connection.name}`);

  let createdCreators = 0;
  let updatedCreators = 0;
  const usersByUsername = new Map();

  for (const creator of orbitCreators) {
    const result = await upsertCreator(creator);
    usersByUsername.set(creator.username, result.user);
    if (result.created) createdCreators += 1;
    else updatedCreators += 1;
  }

  const viewer = await updateExistingViewer();
  await seedCityProgress();
  const dreams = await seedDreams(usersByUsername);

  console.log(`Orbit creators created=${createdCreators} updated=${updatedCreators}`);
  console.log(`Authenticated development viewer updated=${viewer.updated} created=${viewer.created} skipped=${viewer.skipped}`);
  console.log(`Orbit content records upserted=${orbitCreators.filter((creator) => creator.content).length}`);
  console.log(`Orbit dream records upserted=${dreams}`);
  console.log(`City progress records upserted=${cityProgress.length}`);

  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect();
  process.exit(1);
});
