import crypto from "node:crypto";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";

import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import Message from "../models/Message.js";
import MessageReport from "../models/MessageReport.js";
import ProfileMedia from "../models/ProfileMedia.js";
import User from "../models/User.js";

const SOURCE = "client-showcase-v1";
const usernames = [
  "mayamind", "noahliving", "sofiamarin", "oliverwealth", "aishabuildsai",
  "liamtrains", "priyawellness", "lucasframes", "amarafinance", "kenjimoves",
  "elenainsight", "marcusdaily", "zarainframe", "danielmoney", "niacodesai",
  "rafaelstrength", "chloemindful", "arjunmodernlife", "hanastyled", "victorbuilds",
];

function objectId(key) {
  return new mongoose.Types.ObjectId(
    crypto.createHash("sha1").update(`${SOURCE}:${key}`).digest("hex").slice(0, 24),
  );
}

function isImageUrl(value) {
  return typeof value === "string" && /^(?:https?:\/\/|\/uploads\/)/u.test(value)
    && /(?:avatar|profile|cloudinary|image|upload)/iu.test(value);
}

function collectSnapshotUrls(value, found = new Set()) {
  if (isImageUrl(value)) found.add(value);
  if (Array.isArray(value)) value.forEach((item) => collectSnapshotUrls(item, found));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectSnapshotUrls(item, found));
  }
  return found;
}

async function cloudinaryResources(prefix) {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) return [];
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });

  const resources = [];
  let nextCursor;
  do {
    const page = await cloudinary.api.resources({
      resource_type: "image",
      type: "upload",
      prefix,
      max_results: 500,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    });
    resources.push(...(page.resources || []));
    nextCursor = page.next_cursor;
  } while (nextCursor);
  return resources;
}

async function main() {
  await connectDb();
  const ids = usernames.map((username) => objectId(`user:${username}`));
  const users = await User.find({ _id: { $in: ids } })
    .select("name username avatar createdAt updatedAt")
    .lean();
  const allReferencedAvatars = new Set(
    (await User.find({ avatar: { $nin: [null, ""] } }).select("avatar").lean())
      .map((user) => user.avatar),
  );

  const messageSnapshots = await Message.find({
    "sharedContent.author.id": { $in: ids },
    "sharedContent.author.avatarUrl": { $nin: [null, ""] },
  }).select("sharedContent.author createdAt").lean();

  const reports = await MessageReport.find({
    $or: [{ reporter: { $in: ids } }, { reportedUser: { $in: ids } }],
  }).select("+snapshot reporter reportedUser createdAt").lean();

  const profileMedia = await ProfileMedia.find({ owner: { $in: ids } })
    .select("owner type url thumbnailUrl createdAt")
    .sort({ createdAt: -1 })
    .lean();

  const byId = new Map(users.map((user) => [String(user._id), user]));
  const evidence = new Map(users.map((user) => [user.username, new Set()]));
  for (const message of messageSnapshots) {
    const author = message.sharedContent?.author;
    const user = byId.get(String(author?.id));
    if (user && author?.avatarUrl && author.avatarUrl !== user.avatar) {
      evidence.get(user.username).add(author.avatarUrl);
    }
  }
  for (const report of reports) {
    const urls = collectSnapshotUrls(report.snapshot);
    for (const participantId of [report.reporter, report.reportedUser]) {
      const user = byId.get(String(participantId));
      if (!user) continue;
      for (const url of urls) if (url !== user.avatar) evidence.get(user.username).add(url);
    }
  }

  const resources = await cloudinaryResources("onlyme/profiles");
  const unreferencedUploads = resources
    .filter((resource) => !allReferencedAvatars.has(resource.secure_url))
    .map((resource) => ({
      publicId: resource.public_id,
      url: resource.secure_url,
      createdAt: resource.created_at,
      width: resource.width,
      height: resource.height,
      originalFilename: resource.original_filename || "",
      context: resource.context || null,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const result = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    users: users
      .sort((a, b) => usernames.indexOf(a.username) - usernames.indexOf(b.username))
      .map((user) => ({
        id: String(user._id),
        username: user.username,
        name: user.name,
        currentAvatar: user.avatar,
        previousAvatarEvidence: [...(evidence.get(user.username) || [])],
        profileMedia: profileMedia
          .filter((item) => String(item.owner) === String(user._id))
          .map((item) => ({ type: item.type, url: item.url, thumbnailUrl: item.thumbnailUrl, createdAt: item.createdAt })),
      })),
    cloudinary: {
      configured: Boolean(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret),
      profileUploads: resources.length,
      unreferencedUploads,
    },
  };
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
