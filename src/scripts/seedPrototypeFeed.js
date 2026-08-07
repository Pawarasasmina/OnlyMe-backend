import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Publication from "../models/Publication.js";
import SeenEngagement from "../models/SeenEngagement.js";
import User from "../models/User.js";

const SEED_SOURCE = "prototype-feed-v1";
const PASSWORD = "OnlyMeTest123!";
const VIEWER_EMAIL = (process.env.PROTOTYPE_FEED_VIEWER_EMAIL || "creator2@gmail.com").trim().toLowerCase();
const now = new Date();

const PEOPLE = [
  {
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=320&q=80",
    category: "Coffee",
    city: "Dubai",
    country: "UAE",
    email: "prototype.lina@test.onlyme.local",
    name: "Lina Moreau",
    role: "creator",
    username: "prototype_lina",
  },
  {
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=320&q=80",
    category: "Fitness",
    city: "Dubai",
    country: "UAE",
    email: "prototype.ethan@test.onlyme.local",
    name: "Ethan Ward",
    role: "creator",
    username: "prototype_ethan",
  },
  {
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=320&q=80",
    category: "Travel",
    city: "Dubai",
    country: "UAE",
    email: "prototype.mia@test.onlyme.local",
    name: "Mia Chen",
    role: "creator",
    username: "prototype_mia",
  },
  {
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=320&q=80",
    city: "Dubai",
    country: "UAE",
    email: "prototype.fan.one@test.onlyme.local",
    interests: ["Food", "Events", "Travel"],
    name: "Fan One",
    role: "fan",
    username: "prototype_fan_one",
  },
];

const FEED_POSTS = [
  {
    author: "prototype_lina",
    comments: [{ author: "prototype_fan_one", text: "Booked it for Friday." }],
    context: "Coffee",
    key: "food-text",
    location: "Dubai",
    minutesAgo: 120,
    reactions: ["love", "fire", "like"],
    text: "Zuma after 8 PM - book a table in advance. Worth every dirham.",
    views: 673,
  },
  {
    author: "prototype_ethan",
    comments: [{ author: "prototype_mia", text: "Perfect timing." }],
    context: "Right now",
    key: "right-now-compact",
    location: "Dubai",
    media: [{
      assetId: "prototype-feed-right-now-leaves",
      height: 900,
      type: "image",
      url: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80",
      width: 900,
    }],
    minutesAgo: 6,
    reactions: ["like", "love", "fire"],
    shares: ["prototype_fan_one"],
    text: "Right now this place is completely empty. Perfect time to train.",
    views: 757,
  },
  {
    author: "prototype_mia",
    context: "Travel",
    key: "places-note",
    location: "Dubai",
    minutesAgo: 1440,
    reactions: ["like", "useful"],
    text: "Creekside walk is still the calmest reset after a long day. Go near sunset and take the old route back.",
    views: 348,
  },
  {
    author: "prototype_lina",
    context: "Events",
    key: "event-note",
    location: "Dubai",
    minutesAgo: 260,
    reactions: ["care", "love"],
    text: "Small design pop-up tonight near Alserkal. Free entry before 7, quiet enough to actually talk.",
    views: 219,
  },
  {
    author: "prototype_ethan",
    context: "Things to do",
    key: "things-to-do",
    location: "Dubai",
    minutesAgo: 390,
    reactions: ["useful", "like", "clap"],
    text: "Try the early padel slot if you want a court without waiting. The 6 AM crowd is friendly and fast.",
    views: 402,
  },
  {
    author: "prototype_mia",
    context: "Travel",
    key: "large-image",
    location: "Dubai",
    media: [{
      assetId: "prototype-feed-landscape",
      height: 760,
      type: "image",
      url: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1200&q=80",
      width: 1200,
    }],
    minutesAgo: 520,
    reactions: ["love", "fire", "wow"],
    text: "Golden hour over the skyline did the whole thing for us.",
    views: 980,
  },
];

const SEENS = [
  {
    category: "Ideas",
    cover: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    creator: "prototype_mia",
    key: "validate-ideas",
    title: "How I Validate Ideas",
  },
  {
    category: "Food",
    cover: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80",
    creator: "prototype_lina",
    key: "coffee-notes",
    title: "Coffee Notes",
  },
  {
    category: "Places",
    cover: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    creator: "prototype_mia",
    key: "hidden-places",
    title: "3 Hidden Places I Love",
  },
];

function publishedAt(minutesAgo) {
  return new Date(now.getTime() - minutesAgo * 60 * 1000);
}

async function ensureViewer() {
  let user = await User.findOne({ email: VIEWER_EMAIL }).select("+password");
  if (!user) {
    user = await User.create({
      creatorApprovalStatus: "approved",
      email: VIEWER_EMAIL,
      isVerified: true,
      lastSeenAt: now,
      name: "creator2",
      onboarding: { status: "completed", currentStep: "completed", completedAt: now },
      password: PASSWORD,
      role: "creator",
      status: "active",
      username: VIEWER_EMAIL.split("@")[0],
    });
  } else {
    user.role = "creator";
    user.creatorApprovalStatus = "approved";
    user.isVerified = true;
    user.lastSeenAt = now;
    user.status = "active";
    user.onboarding = { ...user.onboarding, status: "completed", currentStep: "completed", completedAt: now };
    await user.save();
  }

  await CreatorProfile.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        bio: "Prototype Home Feed development viewer.",
        category: "Lifestyle",
        categories: ["Lifestyle", "Travel"],
        city: "Dubai",
        country: "UAE",
        profileVisibility: "public",
        "privacySettings.allowDiscovery": true,
        "privacySettings.showActivityStatus": true,
        "privacySettings.showLocation": true,
        verificationStatus: "verified",
      },
    },
    { upsert: true },
  );

  return user;
}

async function ensureUser(seed) {
  let user = await User.findOne({ username: seed.username }).select("+password");
  if (!user) {
    user = await User.create({
      avatar: seed.avatar,
      creatorApprovalStatus: seed.role === "creator" ? "approved" : null,
      email: seed.email,
      isVerified: seed.role === "creator",
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
    user.isVerified = seed.role === "creator";
    user.lastSeenAt = now;
    user.name = seed.name;
    user.role = seed.role;
    user.status = "active";
    await user.save();
  }

  if (seed.role === "creator") {
    await CreatorProfile.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          bio: `${seed.name} prototype feed seed profile.`,
          category: seed.category,
          categories: [seed.category],
          city: seed.city,
          country: seed.country,
          coverPhoto: seed.coverPhoto || "",
          profileVisibility: "public",
          "privacySettings.allowDiscovery": true,
          "privacySettings.showActivityStatus": true,
          "privacySettings.showLocation": true,
          verificationStatus: "verified",
        },
      },
      { upsert: true },
    );
  } else {
    await FanProfile.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          bio: `${seed.name} prototype feed seed profile.`,
          city: seed.city,
          country: seed.country,
          interests: seed.interests || [],
          profileVisibility: "public",
          "privacySettings.allowDiscovery": true,
          "privacySettings.showActivityStatus": true,
          "privacySettings.showLocation": true,
        },
      },
      { upsert: true },
    );
  }

  return user;
}

async function follow(actor, target) {
  await ProfileRelationship.updateOne(
    { actor: actor._id, target: target._id, type: "FOLLOW" },
    { $setOnInsert: { actor: actor._id, target: target._id, type: "FOLLOW" } },
    { upsert: true },
  );
}

function reactionRows(usersByUsername, keys = []) {
  const users = ["prototype_fan_one", "prototype_lina", "prototype_mia", "prototype_ethan"];
  return keys.map((reaction, index) => ({
    reaction,
    user: usersByUsername.get(users[index % users.length])._id,
  }));
}

function viewRows(usersByUsername, count = 0) {
  const viewers = ["prototype_fan_one", "prototype_lina", "prototype_mia", "prototype_ethan"]
    .map((username) => usersByUsername.get(username))
    .filter(Boolean);
  return viewers.slice(0, Math.min(viewers.length, count)).map((user, index) => ({
    user: user._id,
    viewedAt: new Date(now.getTime() - index * 60000),
  }));
}

async function ensureFeedPost(seed, usersByUsername) {
  const author = usersByUsername.get(seed.author);
  const shareUsers = (seed.shares || []).map((username) => usersByUsername.get(username)).filter(Boolean);
  const existing = await FeedPost.findOne({ seedSource: SEED_SOURCE, seedKey: seed.key });
  const date = publishedAt(seed.minutesAgo);
  const comments = (seed.comments || []).map((comment) => ({
    text: comment.text,
    user: usersByUsername.get(comment.author)._id,
    createdAt: new Date(date.getTime() + 4 * 60000),
    updatedAt: new Date(date.getTime() + 4 * 60000),
  }));
  const reactions = reactionRows(usersByUsername, seed.reactions || []);
  const views = viewRows(usersByUsername, seed.views);
  const shares = shareUsers.map((user) => ({
    caption: "",
    user: user._id,
    createdAt: new Date(date.getTime() + 12 * 60000),
    updatedAt: new Date(date.getTime() + 12 * 60000),
  }));

  await FeedPost.findOneAndUpdate(
    { seedSource: SEED_SOURCE, seedKey: seed.key },
    {
      $set: {
        author: author._id,
        commentCount: comments.length,
        comments,
        context: seed.context,
        createdAt: date,
        deletedAt: null,
        location: seed.location,
        media: (seed.media || []).map((media, index) => ({ ...media, sortOrder: index })),
        publishedAt: date,
        reactions,
        saveCount: 0,
        seedKey: seed.key,
        seedSource: SEED_SOURCE,
        shareCount: shares.length,
        shares,
        status: "published",
        supportCount: reactions.length,
        text: seed.text,
        updatedAt: date,
        viewCount: Number(seed.views) || views.length,
        views,
        visibility: "public",
      },
    },
    { setDefaultsOnInsert: true, upsert: true },
  );

  return existing ? "skipped" : "created";
}

async function ensureSeen(seed, usersByUsername) {
  const creator = usersByUsername.get(seed.creator);
  const existing = await Publication.findOne({ seedSource: SEED_SOURCE, seedKey: seed.key });
  const published = publishedAt(seed.key === "validate-ideas" ? 80 : seed.key === "coffee-notes" ? 180 : 260);
  const publication = await Publication.findOneAndUpdate(
    { seedSource: SEED_SOURCE, seedKey: seed.key },
    {
      $set: {
        category: seed.category,
        coverMedia: {
          assetId: `prototype-seen-${seed.key}`,
          mediaType: "IMAGE",
          resourceType: "image",
          secureUrl: seed.cover,
        },
        creator: creator._id,
        kind: "SEEN",
        previewPolicy: "ALL_FREE",
        pricing: { mode: "FREE", starsAmount: 0 },
        publishedAt: published,
        publishedSnapshot: {
          chapters: [
            { stableChapterId: `${seed.key}-chapter-1`, title: seed.title, blocks: [], isPreview: true },
            { stableChapterId: `${seed.key}-chapter-2`, title: "Notes", blocks: [], isPreview: true },
          ],
          frozenAt: published,
          metadata: { title: seed.title, category: seed.category },
          version: 1,
        },
        seedKey: seed.key,
        seedSource: SEED_SOURCE,
        status: "PUBLISHED",
        summary: `${seed.title} prototype feed seed.`,
        title: seed.title,
      },
    },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  );

  await SeenEngagement.updateOne(
    { publication: publication._id, type: "REACTION", user: usersByUsername.get("prototype_fan_one")._id },
    { $set: { publication: publication._id, reaction: "LIKE", type: "REACTION", user: usersByUsername.get("prototype_fan_one")._id } },
    { upsert: true },
  );

  return existing ? "skipped" : "created";
}

async function main() {
  if (env.nodeEnv === "production") {
    throw new Error("Refusing to seed prototype feed data while NODE_ENV=production.");
  }

  await connectDb();
  const viewer = await ensureViewer();
  const people = await Promise.all(PEOPLE.map(ensureUser));
  const usersByUsername = new Map([[viewer.username, viewer], ...people.map((user) => [user.username, user])]);

  await Promise.all(people.map((person) => follow(viewer, person)));
  await Promise.all([
    follow(usersByUsername.get("prototype_lina"), viewer),
    follow(usersByUsername.get("prototype_mia"), viewer),
  ]);

  const postResults = await Promise.all(FEED_POSTS.map((seed) => ensureFeedPost(seed, usersByUsername)));
  const seenResults = await Promise.all(SEENS.map((seed) => ensureSeen(seed, usersByUsername)));

  const postCreated = postResults.filter((result) => result === "created").length;
  const seenCreated = seenResults.filter((result) => result === "created").length;
  console.log("Prototype Home Feed seed complete.");
  console.log(`Viewer: ${viewer.email}`);
  console.log(`Posts created: ${postCreated}; skipped/updated: ${postResults.length - postCreated}`);
  console.log(`Seens created: ${seenCreated}; skipped/updated: ${seenResults.length - seenCreated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
