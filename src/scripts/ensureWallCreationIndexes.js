import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import FeedPost from "../models/FeedPost.js";
import WallCreationLedger from "../models/WallCreationLedger.js";
try {
  await connectDb();
  await FeedPost.collection.createIndex({author:1,creationKey:1},{unique:true,partialFilterExpression:{creationKey:{$type:"string"}}});
  await WallCreationLedger.createCollection().catch((error) => { if (error.code !== 48) throw error; });
  console.log("Wall publication index and ledger collection ready");
} finally { await mongoose.disconnect(); }
