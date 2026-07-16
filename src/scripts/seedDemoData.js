import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import Content from "../models/Content.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";

const demoPassword = "DemoPass123!";

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function upsertUser({ email, name, role, username, avatar = "" }) {
  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      name,
      username,
      email,
      password: demoPassword,
      role,
      avatar,
      isVerified: role === "creator",
    });
    return user;
  }

  user.name = name;
  user.username = username;
  user.role = role;
  user.avatar = avatar || user.avatar;
  if (role === "creator") user.isVerified = true;
  await user.save();
  return user;
}

async function upsertCreatorProfile(user, profile) {
  await CreatorProfile.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        ...profile,
        profileVisibility: "public",
      },
      $setOnInsert: { user: user._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function seed() {
  await connectDb();

  const fan = await upsertUser({
    name: "Fan One",
    username: "fan1",
    email: "fan1@gmail.com",
    role: "fan",
    avatar: "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=240&q=80",
  });

  const creators = await Promise.all([
    upsertUser({
      name: "Maya Moon",
      username: "maya.moon",
      email: "maya.demo@onlyme.test",
      role: "creator",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80",
    }),
    upsertUser({
      name: "Kai Rivers",
      username: "kai.rivers",
      email: "kai.demo@onlyme.test",
      role: "creator",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&q=80",
    }),
    upsertUser({
      name: "Lina Studio",
      username: "lina.studio",
      email: "lina.demo@onlyme.test",
      role: "creator",
      avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&q=80",
    }),
  ]);

  await FanProfile.findOneAndUpdate(
    { user: fan._id },
    {
      $set: {
        bio: "Demo fan account for dashboard testing.",
        profileVisibility: "private",
        preferredLanguage: "en",
        timezone: "Asia/Colombo",
        notificationPreferences: {
          email: true,
          inApp: true,
          marketing: false,
        },
      },
      $setOnInsert: { user: fan._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await Promise.all([
    upsertCreatorProfile(creators[0], {
      bio: "Behind-the-scenes dance clips, warmups, and monthly live sessions.",
      categories: ["dance", "fitness"],
      category: "Dance",
      city: "Los Angeles",
      country: "United States",
      subscriptionPriceCents: 1200,
      monthlyPrice: 12,
      freePreviewEnabled: true,
      messagingEnabled: true,
      ppmEnabled: true,
      ppmPrice: 25,
      verificationStatus: "verified",
    }),
    upsertCreatorProfile(creators[1], {
      bio: "Travel photography, Lightroom breakdowns, and field notes.",
      categories: ["travel", "photography"],
      category: "Photography",
      city: "Vancouver",
      country: "Canada",
      subscriptionPriceCents: 900,
      monthlyPrice: 9,
      freePreviewEnabled: true,
      messagingEnabled: true,
      ppmEnabled: false,
      verificationStatus: "verified",
    }),
    upsertCreatorProfile(creators[2], {
      bio: "Sketchbook tours, process videos, and illustration packs.",
      categories: ["art", "illustration"],
      category: "Art",
      city: "Berlin",
      country: "Germany",
      subscriptionPriceCents: 1500,
      monthlyPrice: 15,
      freePreviewEnabled: true,
      messagingEnabled: true,
      ppmEnabled: true,
      ppmPrice: 40,
      verificationStatus: "verified",
    }),
  ]);

  await Subscription.deleteMany({ fan: fan._id, creator: { $in: creators.map((creator) => creator._id) } });
  await Subscription.insertMany([
    {
      fan: fan._id,
      creator: creators[0]._id,
      status: "active",
      startedAt: daysFromNow(-45),
      nextRenewalAt: daysFromNow(5),
      priceCents: 1200,
      autoRenew: true,
    },
    {
      fan: fan._id,
      creator: creators[1]._id,
      status: "active",
      startedAt: daysFromNow(-12),
      nextRenewalAt: daysFromNow(18),
      priceCents: 900,
      autoRenew: true,
    },
    {
      fan: fan._id,
      creator: creators[2]._id,
      status: "cancelled",
      startedAt: daysFromNow(-90),
      expiresAt: daysFromNow(-3),
      priceCents: 1500,
      autoRenew: false,
    },
  ]);

  const wallet = await Wallet.findOneAndUpdate(
    { user: fan._id },
    { $set: { balance: 3250, currency: "COINS" }, $setOnInsert: { user: fan._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await Transaction.deleteMany({ wallet: wallet._id });
  await Transaction.insertMany([
    {
      wallet: wallet._id,
      amount: 5000,
      type: "credit",
      status: "completed",
      description: "Coin purchase",
    },
    {
      wallet: wallet._id,
      amount: 1200,
      type: "debit",
      status: "completed",
      description: "Subscription payment to Maya Moon",
      creator: creators[0]._id,
    },
    {
      wallet: wallet._id,
      amount: 350,
      type: "debit",
      status: "completed",
      description: "Unlocked a premium photo set",
      creator: creators[1]._id,
    },
    {
      wallet: wallet._id,
      amount: 200,
      type: "credit",
      status: "completed",
      description: "Demo refund credit",
    },
  ]);

  await Content.deleteMany({ creator: { $in: creators.map((creator) => creator._id) }, topic: /^Demo:/ });
  await Content.insertMany([
    {
      creator: creators[0]._id,
      title: "Demo: Morning rehearsal photos",
      topic: "Demo: Morning rehearsal photos",
      description: "Demo published content for creator profile testing.",
      contentType: "image",
      images: [
        {
          publicId: `onlyme/${creators[0]._id}/demo-rehearsal`,
          url: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=800&q=80",
          isMain: true,
        },
      ],
      status: "published",
      publishedAt: daysFromNow(-7),
      accessLevel: "subscribers",
    },
  ]);

  await Message.deleteMany({
    $or: [
      { sender: fan._id, recipient: { $in: creators.map((creator) => creator._id) } },
      { recipient: fan._id, sender: { $in: creators.map((creator) => creator._id) } },
    ],
  });
  await Message.insertMany([
    {
      sender: creators[0]._id,
      recipient: fan._id,
      body: "Thanks for joining, Fan One. I just posted this week's rehearsal notes.",
      mediaType: "text",
      readAt: null,
    },
    {
      sender: creators[1]._id,
      recipient: fan._id,
      body: "Sent an image",
      mediaType: "image",
      readAt: daysFromNow(-1),
    },
    {
      sender: fan._id,
      recipient: creators[2]._id,
      body: "Loved the latest sketch pack!",
      mediaType: "text",
      ppm: true,
      readAt: daysFromNow(-2),
    },
  ]);

  await Notification.deleteMany({ user: fan._id, title: /^Demo:/ });
  await Notification.insertMany([
    {
      user: fan._id,
      type: "subscription",
      title: "Demo: Maya Moon subscription renews soon",
      readAt: null,
    },
    {
      user: fan._id,
      type: "wallet",
      title: "Demo: Wallet credited with 200 coins",
      readAt: daysFromNow(-1),
    },
  ]);

  console.log("Demo data seeded successfully.");
  console.log("Fan login: fan1@gmail.com / DemoPass123!");
  console.log("Creator logins: maya.demo@onlyme.test, kai.demo@onlyme.test, lina.demo@onlyme.test / DemoPass123!");

  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
