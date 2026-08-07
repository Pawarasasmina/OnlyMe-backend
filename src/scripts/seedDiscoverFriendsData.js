import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import PremiumMembership from "../models/PremiumMembership.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import Story from "../models/Story.js";
import StoryEngagement from "../models/StoryEngagement.js";
import User from "../models/User.js";
import WorldEntitlement from "../models/WorldEntitlement.js";

const PASSWORD = "OnlyMeTest123!";
const now = new Date();
const expiresAt = new Date(now.getTime() + 23 * 60 * 60 * 1000);
const VIEWER_EMAIL = (process.env.DISCOVER_SEED_VIEWER_EMAIL || "creator2@gmail.com").trim().toLowerCase();
const VIEWER_USERNAME = (process.env.DISCOVER_SEED_VIEWER_USERNAME || VIEWER_EMAIL.split("@")[0] || "creator2").trim().toLowerCase();

const VIEWER_PROFILE = {
  avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=320&q=80",
  category: "Lifestyle",
  city: "Dubai",
  country: "UAE",
  coverPhoto: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=900&q=80",
  email: VIEWER_EMAIL,
  interests: ["Coffee", "Travel", "Fitness"],
  name: "creator2",
  role: "creator",
  username: VIEWER_USERNAME,
};

const DISCOVER_PEOPLE = [
  {
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=320&q=80",
    category: "Coffee",
    city: "Colombo",
    country: "Sri Lanka",
    coverPhoto: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80",
    email: "lina.friend@test.onlyme.local",
    name: "Lina Moreau",
    role: "creator",
    username: "lina_friend_story",
  },
  {
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=320&q=80",
    category: "Travel",
    city: "Kandy",
    country: "Sri Lanka",
    coverPhoto: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    email: "mia.friend@test.onlyme.local",
    name: "Mia Chen",
    role: "creator",
    username: "mia_friend_seen",
  },
  {
    avatar: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=320&q=80",
    city: "Galle",
    country: "Sri Lanka",
    email: "zoe.friend@test.onlyme.local",
    interests: ["Art", "Music"],
    name: "Zoe Silva",
    role: "fan",
    username: "zoe_friend_no_story",
  },
  {
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=320&q=80",
    category: "Business",
    city: "Dubai",
    country: "UAE",
    coverPhoto: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    email: "james.following@test.onlyme.local",
    name: "James Cole",
    role: "creator",
    username: "james_following_only",
  },
  {
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=320&q=80",
    category: "Tennis",
    city: "Dubai",
    country: "UAE",
    coverPhoto: "https://images.unsplash.com/photo-1542144582-1ba00456b5e3?auto=format&fit=crop&w=900&q=80",
    email: "omar.suggested@test.onlyme.local",
    name: "Omar Hadid",
    role: "creator",
    username: "omar_suggested_test",
  },
];

const STORIES = [
  {
    caption: "Coffee in hand - ask away.",
    creator: "lina_friend_story",
    image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
    minutesAgo: 12,
  },
  {
    caption: "Morning plans from the studio.",
    creator: "lina_friend_story",
    image: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80",
    minutesAgo: 6,
  },
  {
    caption: "Train window notes.",
    creator: "mia_friend_seen",
    image: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80",
    minutesAgo: 40,
    viewed: true,
  },
  {
    caption: "Leg day. Back in 1 hour.",
    creator: "james_following_only",
    image: "https://images.unsplash.com/photo-1534367610401-9f5ed68180aa?auto=format&fit=crop&w=900&q=80",
    minutesAgo: 18,
  },
];

async function upsertUser(seed) {
  let user = await User.findOne({ username: seed.username }).select("+password");
  if (!user) {
    user = await User.create({
      avatar: seed.avatar,
      creatorApprovalStatus: seed.role === "creator" ? "approved" : null,
      email: seed.email,
      isVerified: seed.role === "creator" && seed.username !== "james_following_only",
      lastSeenAt: now,
      name: seed.name,
      onboarding: { status: "completed", currentStep: "completed", completedAt: now },
      password: PASSWORD,
      role: seed.role,
      status: "active",
      username: seed.username,
    });
  } else {
    user.avatar = seed.avatar;
    user.creatorApprovalStatus = seed.role === "creator" ? "approved" : null;
    user.email = seed.email;
    user.isVerified = seed.role === "creator" && seed.username !== "james_following_only";
    user.lastSeenAt = now;
    user.name = seed.name;
    user.onboarding = { ...user.onboarding, status: "completed", currentStep: "completed", completedAt: now };
    user.password = PASSWORD;
    user.role = seed.role;
    user.status = "active";
    await user.save();
  }
  return user;
}

async function upsertViewer(seed) {
  let user = await User.findOne({ email: seed.email }).select("+password");

  if (!user) {
    user = await User.create({
      avatar: seed.avatar,
      creatorApprovalStatus: "approved",
      email: seed.email,
      isVerified: true,
      lastSeenAt: now,
      name: seed.name,
      onboarding: { status: "completed", currentStep: "completed", completedAt: now },
      password: PASSWORD,
      role: seed.role,
      status: "active",
      username: seed.username,
    });
    return user;
  }

  if (!user.avatar) user.avatar = seed.avatar;
  if (!user.name) user.name = seed.name;
  if (user.role === "creator") {
    user.creatorApprovalStatus = "approved";
    user.isVerified = true;
  }
  user.lastSeenAt = now;
  user.onboarding = { ...user.onboarding, status: "completed", currentStep: "completed", completedAt: now };
  user.status = "active";
  await user.save();
  return user;
}

async function upsertProfile(user, seed) {
  if (seed.role === "creator") {
    await CreatorProfile.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          bio: `${seed.name} is seeded test data for Discover Friends.`,
          category: seed.category,
          categories: [seed.category],
          city: seed.city,
          country: seed.country,
          coverPhoto: seed.coverPhoto,
          directAccessEnabled: seed.username === "lina_friend_story",
          orbitQuote: `You both follow ${seed.category}.`,
          profileVisibility: "public",
          "privacySettings.allowDiscovery": true,
          "privacySettings.showActivityStatus": true,
          "privacySettings.showLocation": true,
          verificationStatus: "verified",
        },
      },
      { new: true, upsert: true },
    );
    return;
  }

  await FanProfile.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        bio: `${seed.name} is seeded test data for Discover Friends.`,
        city: seed.city,
        country: seed.country,
        interests: seed.interests || [],
        profileVisibility: "public",
        "privacySettings.allowDiscovery": true,
        "privacySettings.showActivityStatus": true,
        "privacySettings.showLocation": true,
      },
    },
    { new: true, upsert: true },
  );
}

async function follow(actor, target) {
  await ProfileRelationship.updateOne(
    { actor: actor._id, target: target._id, type: "FOLLOW" },
    { $setOnInsert: { actor: actor._id, target: target._id, type: "FOLLOW" } },
    { upsert: true },
  );
}

async function createStories(usersByUsername, viewer) {
  await Story.deleteMany({ creator: { $in: STORIES.map((story) => usersByUsername.get(story.creator)?._id).filter(Boolean) } });
  for (const story of STORIES) {
    const creator = usersByUsername.get(story.creator);
    if (!creator) continue;
    const createdAt = new Date(now.getTime() - story.minutesAgo * 60 * 1000);
    const created = await Story.create({
      audience: "followers",
      caption: story.caption,
      creator: creator._id,
      duration: 5,
      expiresAt,
      image: { assetId: `seed-${story.creator}-${story.minutesAgo}`, resourceType: "image", url: story.image },
      mediaType: "image",
      createdAt,
      updatedAt: createdAt,
    });
    if (story.viewed) {
      await StoryEngagement.updateOne(
        { fan: viewer._id, story: created._id },
        { $set: { viewedAt: now } },
        { upsert: true },
      );
    }
  }
}

async function createPremiumWorld(lina) {
  await Publication.findOneAndUpdate(
    { creator: lina._id, kind: "PREMIUM_WORLD" },
    {
      $set: {
        category: "Coffee",
        coverMedia: { assetId: "seed-premium-lina-cover", resourceType: "image", mediaType: "IMAGE", secureUrl: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=80" },
        creator: lina._id,
        kind: "PREMIUM_WORLD",
        previewPolicy: "ONE_CHAPTER",
        pricing: { mode: "MONTHLY", starsAmount: 190 },
        publishedAt: now,
        publishedSnapshot: {
          chapters: [{ stableChapterId: "seed-premium-chapter", title: "Coffee Notes", blocks: [], isPreview: true }],
          frozenAt: now,
          metadata: { title: "Coffee Notes", category: "Coffee" },
          version: 1,
        },
        status: "PUBLISHED",
        title: "Coffee Notes",
      },
    },
    { new: true, upsert: true },
  );
}

async function main() {
  await connectDb();
  const viewer = await upsertViewer(VIEWER_PROFILE);
  const users = await Promise.all(DISCOVER_PEOPLE.map(upsertUser));
  const usersByUsername = new Map([[viewer.username, viewer], ...users.map((user) => [user.username, user])]);
  await upsertProfile(viewer, { ...VIEWER_PROFILE, role: viewer.role === "creator" ? "creator" : "fan" });
  await Promise.all(DISCOVER_PEOPLE.map((seed) => upsertProfile(usersByUsername.get(seed.username), seed)));

  const lina = usersByUsername.get("lina_friend_story");
  const mia = usersByUsername.get("mia_friend_seen");
  const zoe = usersByUsername.get("zoe_friend_no_story");
  const james = usersByUsername.get("james_following_only");
  const omar = usersByUsername.get("omar_suggested_test");

  await Promise.all([
    follow(viewer, lina),
    follow(lina, viewer),
    follow(viewer, mia),
    follow(mia, viewer),
    follow(viewer, zoe),
    follow(zoe, viewer),
    follow(viewer, james),
    follow(lina, omar),
    follow(mia, omar),
  ]);

  await createStories(usersByUsername, viewer);
  await createPremiumWorld(lina);

  await Promise.all([
    PremiumMembership.deleteMany({ user: viewer._id, creator: lina._id }),
    WorldEntitlement.deleteMany({ user: viewer._id, creator: lina._id }),
  ]);

  console.log("Discover Friends seed complete.");
  console.log(`Login email: ${viewer.email}`);
  console.log("Existing viewer passwords are preserved. If the viewer was created by this seed, its password is OnlyMeTest123!.");
  console.log("Expected Friends: Lina Moreau (unseen story + premium badge), Mia Chen (seen story), Zoe Silva (no story).");
  console.log("Expected Following-only: James Cole (unseen story).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
