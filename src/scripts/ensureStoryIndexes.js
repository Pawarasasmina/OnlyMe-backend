import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import Story from "../models/Story.js";
import Message from "../models/Message.js";

// Read-only unless --apply is supplied. Never drops an index or rewrites content.
await connectDb();
try {
  const definitions = [
    [Story.collection, { creator: 1, publishKey: 1 }, { unique: true, partialFilterExpression: { publishKey: { $type: "string" } } }],
    [Message.collection, { storyReactionKey: 1 }, { unique: true, sparse: true }],
  ];
  for (const [collection, keys, options] of definitions) {
    console.log(JSON.stringify({ collection: collection.collectionName, keys, options, apply: process.argv.includes("--apply") }));
    if (process.argv.includes("--apply")) await collection.createIndex(keys, options);
  }
} finally { await mongoose.disconnect(); }
