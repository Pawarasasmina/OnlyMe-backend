import { connectDb } from "../config/db.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import Publication from "../models/Publication.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";

const PASSWORD = "OnlyMeTest123!";
const FAN_EMAIL = "premium.join.fan@test.onlyme.local";
const FAN_USERNAME = "premium_join_fan";
const CREATOR_EMAIL = "premium.join.creator@test.onlyme.local";
const CREATOR_USERNAME = "premium_join_creator";
const now = new Date();

async function upsertUser({ email, name, role, username }) {
  let user = await User.findOne({ $or: [{ email }, { username }] }).select("+password");
  if (!user) {
    user = await User.create({
      creatorApprovalStatus: role === "creator" ? "approved" : null,
      email,
      isVerified: role === "creator",
      name,
      onboarding: { status: "completed", currentStep: "completed", completedAt: now },
      password: PASSWORD,
      role,
      status: "active",
      username,
    });
  } else {
    user.email = email;
    user.name = name;
    user.role = role;
    user.status = "active";
    user.isVerified = role === "creator";
    user.creatorApprovalStatus = role === "creator" ? "approved" : null;
    user.onboarding = { ...user.onboarding, status: "completed", currentStep: "completed", completedAt: now };
    await user.save();
  }
  return user;
}

async function seedWallet(user) {
  await Wallet.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        balance: 10000,
        bonusBalance: 0,
        currency: "STARS",
        earnedBalance: 0,
        ledgerActivatedAt: now,
        purchasedBalance: 10000,
        reconciliationStatus: "MATCHED",
      },
      $setOnInsert: { version: 0 },
    },
    { new: true, upsert: true, runValidators: true },
  );
}

async function seedProfiles(fan, creator) {
  await FanProfile.findOneAndUpdate(
    { user: fan._id },
    {
      $set: {
        bio: "Dev fan account with an activated Stars wallet for Premium World join testing.",
        city: "Colombo",
        country: "Sri Lanka",
        interests: ["Creator worlds", "Stories", "Direct access"],
        profileVisibility: "public",
        "privacySettings.allowDiscovery": true,
      },
    },
    { upsert: true },
  );
  await CreatorProfile.findOneAndUpdate(
    { user: creator._id },
    {
      $set: {
        bio: "Dev creator account with a joinable Premium World.",
        category: "Lifestyle",
        categories: ["Lifestyle"],
        city: "Colombo",
        country: "Sri Lanka",
        directAccessEnabled: true,
        directAccessMessageLimit: 3,
        directAccessWindowHours: 48,
        profileVisibility: "public",
        "privacySettings.allowDiscovery": true,
        verificationStatus: "verified",
      },
    },
    { upsert: true },
  );
}

async function seedPremiumWorld(creator) {
  const chapters = [
    { stableChapterId: "join-test-preview", order: 0, title: "The open door", isPreview: true, blocks: [{ type: "TEXT", text: "A public preview before joining.", order: 0 }] },
    { stableChapterId: "join-test-private-1", order: 1, title: "Private note one", isPreview: false, blocks: [{ type: "TEXT", text: "Member-only chapter one.", order: 0, metadata: { storyPreview: true } }] },
    { stableChapterId: "join-test-private-2", order: 2, title: "Private note two", isPreview: false, blocks: [{ type: "TEXT", text: "Member-only chapter two.", order: 0 }] },
    { stableChapterId: "join-test-private-3", order: 3, title: "Private note three", isPreview: false, blocks: [{ type: "TEXT", text: "Member-only chapter three.", order: 0 }] },
  ];
  const metadata = {
    category: "Lifestyle",
    commentsEnabled: true,
    description: "A seeded Premium World for testing the Join -> inside membership flow.",
    directAccessIncluded: true,
    directAccessIncludedReplies: 3,
    firstMonthOfferEnabled: true,
    kind: "PREMIUM_WORLD",
    memberPriceLocked: true,
    planet: { emoji: "🪐", faceEmoji: "🪐", slot: "PREMIUM", accent: "#9ccbff" },
    pricing: { mode: "MONTHLY", starsAmount: 290, presetId: "P290" },
    summary: "Joinable seeded Premium World.",
    tags: ["testing", "premium"],
    title: "Join Test World",
    visibility: "PUBLIC",
  };
  return Publication.findOneAndUpdate(
    { creator: creator._id, kind: "PREMIUM_WORLD" },
    {
      $set: {
        category: metadata.category,
        commentsEnabled: true,
        creator: creator._id,
        description: metadata.description,
        directAccessIncluded: true,
        directAccessIncludedReplies: 3,
        firstMonthOfferEnabled: true,
        kind: "PREMIUM_WORLD",
        memberPriceLocked: true,
        planet: metadata.planet,
        previewPolicy: "ONE_CHAPTER",
        pricing: metadata.pricing,
        publishedAt: now,
        publishedSnapshot: { chapters, frozenAt: now, metadata, version: 1 },
        publishedVersion: 1,
        status: "PUBLISHED",
        summary: metadata.summary,
        title: metadata.title,
        visibility: "PUBLIC",
        worldFoundingCapacity: 250,
      },
    },
    { new: true, upsert: true, runValidators: true },
  );
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed Premium join test data in production.");
  await connectDb();
  const fan = await upsertUser({ email: FAN_EMAIL, name: "Premium Join Fan", role: "fan", username: FAN_USERNAME });
  const creator = await upsertUser({ email: CREATOR_EMAIL, name: "Premium Join Creator", role: "creator", username: CREATOR_USERNAME });
  await seedProfiles(fan, creator);
  await seedWallet(fan);
  const world = await seedPremiumWorld(creator);
  console.log("Premium join test account ready.");
  console.log(`Fan login: ${FAN_EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log(`Creator profile: /profile/${CREATOR_USERNAME}`);
  console.log(`World URL: /world/${world._id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 50);
  });
