import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import FeedPost from "../models/FeedPost.js";
import User from "../models/User.js";

const SOURCE = "updated-wall-notes-v1";
const HOUR = 60 * 60 * 1000;

const creators = [
  ["maya@gmail.com", "Maya", "Colombo, Sri Lanka", "LK", "LKR", "Psychology"],
  ["noah@gmail.com", "Noah", "London, United Kingdom", "GB", "GBP", "Lifestyle"],
  ["sofia@gmail.com", "Sofia", "Barcelona, Spain", "ES", "EUR", "Fashion"],
  ["oliver@gmail.com", "Oliver", "Toronto, Canada", "CA", "CAD", "Finance"],
  ["aisha@gmail.com", "Aisha", "Dubai, United Arab Emirates", "AE", "AED", "AI/Tech"],
  ["liam@gmail.com", "Liam", "Sydney, Australia", "AU", "AUD", "Fitness"],
  ["priya@gmail.com", "Priya", "Bengaluru, India", "IN", "INR", "Psychology"],
  ["lucas@gmail.com", "Lucas", "New York, United States", "US", "USD", "Fashion"],
  ["amara@gmail.com", "Amara", "Lagos, Nigeria", "NG", "NGN", "Finance"],
  ["kenji@gmail.com", "Kenji", "Tokyo, Japan", "JP", "JPY", "Fitness"],
  ["elena@gmail.com", "Elena", "Berlin, Germany", "DE", "EUR", "Psychology"],
  ["marcus@gmail.com", "Marcus", "Singapore, Singapore", "SG", "SGD", "Lifestyle"],
  ["zara@gmail.com", "Zara", "Paris, France", "FR", "EUR", "Fashion"],
  ["daniel@gmail.com", "Daniel", "Seoul, South Korea", "KR", "KRW", "Finance"],
  ["nia@gmail.com", "Nia", "San Francisco, United States", "US", "USD", "AI/Tech"],
  ["rafael@gmail.com", "Rafael", "Lisbon, Portugal", "PT", "EUR", "Fitness"],
  ["chloe@gmail.com", "Chloe", "Melbourne, Australia", "AU", "AUD", "Psychology"],
  ["arjun@gmail.com", "Arjun", "Mumbai, India", "IN", "INR", "Lifestyle"],
  ["hana@gmail.com", "Hana", "Kyoto, Japan", "JP", "JPY", "Fashion"],
  ["victor@gmail.com", "Victor", "Accra, Ghana", "GH", "GHS", "AI/Tech"],
].map(([email, first, location, countryCode, currency, category]) => ({ email, first, location, countryCode, currency, category }));

const categoryDetails = {
  Psychology: {
    topic: "Wellness",
    images: ["1506126613408-eca07ce68773", "1500530855697-b586d89ba3ee", "1474418397713-7ede21d49118"],
    offering: "I am hosting a small guided reset session this weekend. We will practise one grounding tool and leave time for questions. Beginners are very welcome.",
    question: "What is one small ritual that helps you come back to yourself after a demanding day? I am collecting practical ideas for the community.",
  },
  Lifestyle: {
    topic: "Lifestyle",
    images: ["1494438639946-1ebd1d20bf85", "1524758631624-e2822e304c36", "1501339847302-ac426a4a7cbb"],
    offering: "I mapped a simple weekend reset for busy weeks: one clear surface, one good meal and one hour outside. Sharing the full checklist here tomorrow.",
    question: "What is the most peaceful place in your city for a slow coffee and an hour of reading? Local recommendations only, please.",
  },
  Fashion: {
    topic: "Lifestyle",
    images: ["1529139574466-a303027c1d8b", "1483985988355-763728e1935b", "1509631179647-0177331693ae"],
    offering: "I am reviewing three emerging-model portfolios this week. Send one strong project and a short note about the story you want your images to tell.",
    question: "Which detail makes an outfit feel intentional to you: shape, texture, colour or the way it moves? I am planning my next editorial study.",
  },
  Finance: {
    topic: "Work",
    images: ["1554224155-8d04cb21cd6c", "1454165804606-c3d57bc86b40", "1556761175-b413da4baf72"],
    offering: "I made a one-page monthly money check-in for creators: cash in, commitments, runway and one next decision. Happy to share the template.",
    question: "What part of pricing your work feels hardest right now: setting the number, explaining the value or holding the boundary?",
  },
  "AI/Tech": {
    topic: "Learning",
    images: ["1518770660439-4636190af475", "1488590528505-98d2b5aba04b", "1555949963-ff9fe0c870eb"],
    offering: "I am testing a small AI workflow clinic: bring one repetitive task and we will map a safe automation with a clear human checkpoint.",
    question: "Which everyday task would you automate first if the tool stayed transparent, private and easy to undo? I want real problems, not demos.",
  },
  Fitness: {
    topic: "Wellness",
    images: ["1517836357463-d25dfeac3438", "1571019613454-1cb2f99b2d8b", "1534438327276-14e5300c3a48"],
    offering: "Free outdoor movement session this Saturday: mobility, simple strength and an easy finish. Every level is welcome; bring water and comfortable shoes.",
    question: "What usually breaks your training rhythm: time, recovery, confidence or not knowing what to do next? I am building a more repeatable plan.",
  },
};

const secondaryTypes = [
  ["Need Help", "Services", "Need help"],
  ["Recommendation", "Places", "Recommendation"],
  ["Looking for", "Meet people", "Looking for"],
  ["Buy & Sell", "Buy / Sell", "Buy/Sell"],
  ["Event", "Community", "Events"],
  ["Right Now", "Meet people", "Right now"],
  ["Question", "Learning", "Advice"],
  ["Offering", "Services", "Other"],
];

const imageUrl = (photoId, width = 1200, height = 1500) =>
  `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${width}&h=${height}&q=84`;

const stableObjectId = key => new mongoose.Types.ObjectId(
  crypto.createHash("sha1").update(`${SOURCE}:${key}`).digest("hex").slice(0, 24)
);

function mediaFor(creator, noteIndex, photoIds) {
  const count = noteIndex === 0 && creator.category === "Fashion" ? 2 : 1;
  return photoIds.slice(0, count).map((photoId, index) => ({
    _id: stableObjectId(`${creator.email}:note-${noteIndex}:media-${index}`),
    assetId: `${SOURCE}-${creator.email.split("@")[0]}-${noteIndex}-${index}`,
    url: imageUrl(photoId),
    type: "image",
    format: "jpg",
    mimeType: "image/jpeg",
    width: 1200,
    height: 1500,
    sortOrder: index,
    originalName: `${creator.category.toLowerCase().replace(/[^a-z]+/g, "-")}-${index + 1}.jpg`,
  }));
}

function noteDefinitions(creator, index) {
  const detail = categoryDetails[creator.category];
  const [postType, topic, context] = secondaryTypes[index % secondaryTypes.length];
  const specialText = {
    "Need Help": `Does anyone in ${creator.location.split(",")[0]} know a reliable local service for a small studio setup this week? Personal recommendations would really help.`,
    Recommendation: `My favourite quiet work spot in ${creator.location.split(",")[0]} this month. Good light, kind staff and enough space to think. What place should I try next?`,
    "Looking for": `Looking for two people in ${creator.location.split(",")[0]} who want to test a small ${creator.category.toLowerCase()} community session next week.`,
    "Buy & Sell": `Selling a lightly used creator setup that deserves a new home. Everything works well, collection in ${creator.location.split(",")[0]}.`,
    Event: `Small community meet-up in ${creator.location.split(",")[0]} this weekend: honest conversation, useful ideas and no pressure to perform.`,
    "Right Now": `I have an open hour in ${creator.location.split(",")[0]} right now and I am trying a new ${creator.category.toLowerCase()} idea. Say hello if you are nearby.`,
    Question: detail.question,
    Offering: detail.offering,
  }[postType];

  return [
    {
      postType: "Offering",
      topic: detail.topic,
      context: creator.category === "Fitness" ? "Fitness" : creator.category === "Lifestyle" ? "Updates" : "Other",
      text: detail.offering,
      rightNow: [0, 4, 9, 14, 18].includes(index),
      media: mediaFor(creator, 0, detail.images),
    },
    {
      postType,
      topic,
      context,
      text: specialText,
      rightNow: postType === "Right Now",
      price: postType === "Buy & Sell" ? 125 : null,
      currency: postType === "Buy & Sell" ? creator.currency : "",
      media: mediaFor(creator, 1, [...detail.images].reverse()),
    },
  ];
}

function engagementFor(users, authorIndex, noteIndex, publishedAt) {
  const actors = [1, 3, 6].map(offset => users[(authorIndex + offset + noteIndex) % users.length]);
  const reactions = ["love", "useful", "fire"].map((reaction, index) => ({
    _id: stableObjectId(`reaction:${authorIndex}:${noteIndex}:${index}`),
    user: actors[index]._id,
    actorAccountType: actors[index].accountType,
    reaction,
    createdAt: new Date(publishedAt.getTime() + (index + 1) * 11 * 60 * 1000),
    updatedAt: new Date(publishedAt.getTime() + (index + 1) * 11 * 60 * 1000),
  }));
  const comments = [{
    _id: stableObjectId(`comment:${authorIndex}:${noteIndex}`),
    parentCommentId: null,
    reactions: [],
    user: actors[0]._id,
    actorAccountType: actors[0].accountType,
    text: noteIndex === 0 ? "This is genuinely useful. I would love to join." : "Great idea — thanks for sharing this with the community.",
    deletedAt: null,
    archivedAt: null,
    createdAt: new Date(publishedAt.getTime() + 35 * 60 * 1000),
    updatedAt: new Date(publishedAt.getTime() + 35 * 60 * 1000),
  }];
  const views = users
    .filter((_, index) => index !== authorIndex)
    .slice(0, 8 + (authorIndex % 5))
    .map((user, index) => ({ user: user._id, actorAccountType: user.accountType, viewedAt: new Date(publishedAt.getTime() + (index + 1) * 7 * 60 * 1000) }));
  return { reactions, comments, views };
}

async function main() {
  await connectDb();
  const emails = creators.map(creator => creator.email);
  const found = await User.find({ email: { $in: emails } }).select("+accountType email firstName lastName username").lean();
  const byEmail = new Map(found.map(user => [String(user.email).toLowerCase(), user]));
  const missing = emails.filter(email => !byEmail.has(email));
  if (missing.length) throw new Error(`Cannot seed Wall notes. Missing creator accounts: ${missing.join(", ")}`);

  const users = creators.map(creator => ({ ...byEmail.get(creator.email), accountType: byEmail.get(creator.email).accountType || "SEED" }));
  let upserted = 0;
  let updated = 0;

  for (let authorIndex = 0; authorIndex < creators.length; authorIndex += 1) {
    const creator = creators[authorIndex];
    const author = users[authorIndex];
    const definitions = noteDefinitions(creator, authorIndex);
    for (let noteIndex = 0; noteIndex < definitions.length; noteIndex += 1) {
      const definition = definitions[noteIndex];
      const seedKey = `${creator.email.split("@")[0]}-${noteIndex + 1}`;
      const publishedAt = definition.rightNow
        ? new Date(Date.now() - (1 + (authorIndex % 5)) * HOUR)
        : new Date(Date.now() - (authorIndex * 2 + noteIndex + 2) * HOUR);
      const engagement = engagementFor(users, authorIndex, noteIndex, publishedAt);
      const result = await FeedPost.updateOne(
        { seedSource: SOURCE, seedKey },
        {
          $set: {
            author: author._id,
            text: definition.text,
            resolvedAt: authorIndex % 9 === 0 && noteIndex === 1 ? new Date(publishedAt.getTime() + HOUR) : null,
            editedAt: authorIndex % 7 === 0 ? new Date(publishedAt.getTime() + 20 * 60 * 1000) : null,
            noteVersions: [],
            bumpedAt: null,
            bumpCount: 0,
            outdatedVoters: [],
            rightNow: Boolean(definition.rightNow),
            creationKey: `${SOURCE}:${seedKey}`,
            creationFingerprint: crypto.createHash("sha256").update(`${creator.email}:${definition.text}`).digest("hex"),
            moderationStatus: "CLEAR",
            moderationReason: "",
            moderationEvidence: null,
            postType: definition.postType,
            topic: definition.topic,
            context: definition.context,
            location: creator.location,
            countryCode: creator.countryCode,
            price: definition.price ?? null,
            currency: definition.currency ?? "",
            entityRefs: [],
            media: definition.media,
            visibility: "public",
            status: "published",
            reactions: engagement.reactions,
            comments: engagement.comments,
            saves: [],
            views: engagement.views,
            shares: [],
            hiddenBy: [],
            reports: [],
            moderationHiddenAt: null,
            qualifyingReportCount: 0,
            moderationReportRevision: "",
            supportCount: engagement.reactions.length,
            commentCount: engagement.comments.length,
            saveCount: 0,
            viewCount: engagement.views.length,
            shareCount: 0,
            privateShareCount: 0,
            seedSource: SOURCE,
            seedKey,
            deletedAt: null,
            publishedAt,
            createdAt: publishedAt,
            updatedAt: publishedAt,
          },
        },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true, timestamps: false }
      );
      if (result.upsertedCount) upserted += 1;
      else updated += 1;
    }
  }

  const total = await FeedPost.countDocuments({ seedSource: SOURCE, status: "published", deletedAt: null });
  const withImages = await FeedPost.countDocuments({ seedSource: SOURCE, "media.0": { $exists: true } });
  console.log(`Updated Wall note seed complete: ${total} notes across ${users.length} creators (${upserted} inserted, ${updated} refreshed, ${withImages} with images).`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
