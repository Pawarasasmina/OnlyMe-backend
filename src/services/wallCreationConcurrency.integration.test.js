import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import UserBlock from "../models/UserBlock.js";
import FeedPost from "../models/FeedPost.js";
import WallCreationLedger from "../models/WallCreationLedger.js";
import { createFeedPost, getWallNeedCounts } from "../controllers/postController.js";
import { reserveWallCreation } from "./wallCreationService.js";

// Explicit opt-in keeps the normal test suite offline and free of binary downloads.
test("atomic Wall quota, duplicate reservations, release and idempotency index", { skip: process.env.WALL_MONGO_INTEGRATION !== "1", timeout: 180000 }, async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    await Promise.all([FeedPost.init(),WallCreationLedger.init()]);
    const author=new mongoose.Types.ObjectId();
    const requests=await Promise.allSettled(Array.from({length:12},(_,i)=>reserveWallCreation(author,`note ${i}`,`request_${i}`)));
    assert.equal(requests.filter(r=>r.status==="fulfilled").length,5);
    const winner=requests.find(r=>r.status==="fulfilled");
    await winner.value();
    await reserveWallCreation(author,"replacement","replacement_key");
    await assert.rejects(reserveWallCreation(author,"sixth","another_key"));
    const other=new mongoose.Types.ObjectId();
    const duplicates=await Promise.allSettled([reserveWallCreation(other," Same ","duplicate_one"),reserveWallCreation(other,"same","duplicate_two")]);
    assert.equal(duplicates.filter(r=>r.status==="fulfilled").length,1);
    const post={author:other,postType:"Buy & Sell",topic:"Housing",text:"A sale",creationKey:"unique_request",creationFingerprint:"hash",publishedAt:new Date()};
    await FeedPost.create(post);
    await assert.rejects(FeedPost.create(post),error=>error.code===11000);
    const seeded=new mongoose.Types.ObjectId();
    await FeedPost.create(Array.from({length:5},(_,i)=>({author:seeded,text:`old ${i}`,publishedAt:new Date(),status:i%2?"archived":"deleted",deletedAt:i%2?null:new Date()})));
    await assert.rejects(reserveWallCreation(seeded,"new","seeded_new"));
    // Exercise real controller persistence/replay against the isolated database.
    const publisher = new mongoose.Types.ObjectId();
    const request = { user: { _id: publisher, role: "fan" }, body: { postType: "Buy & Sell", topic: "Housing", text: "A real fixture note", rightNow: "true", location: "Fixture City" }, files: {}, get: () => "fixture_publication_key" };
    const response = () => ({ status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } });
    let error;
    const first=response();
    await createFeedPost(request,first,(value)=>{error=value;});
    assert.ifError(error);
    assert.equal(first.code,201);
    const second=response();
    await createFeedPost(request,second,(value)=>{error=value;});
    assert.ifError(error);
    assert.equal(second.code,200);
    assert.equal(second.body.data.post.id,first.body.data.post.id);
    assert.equal(second.body.data.post.postType,"Buy & Sell");
    assert.equal(second.body.data.post.topic,"Housing");
    assert.equal(await FeedPost.countDocuments({author:publisher}),1);
    const readBack=await FeedPost.findById(first.body.data.post.id).lean();
    assert.equal(readBack.rightNow,true);
    const mismatch=response();
    let mismatchError;
    await createFeedPost({...request,body:{...request.body,text:"Changed payload"}},mismatch,(value)=>{mismatchError=value;});
    assert.equal(mismatchError.statusCode,409);
    let invalidError;
    await createFeedPost({...request,get:()=>"invalid_topic_request",body:{...request.body,text:"Invalid topic fixture",topic:"invalid"}},response(),(value)=>{invalidError=value;});
    assert.ok(invalidError);
    assert.equal((await WallCreationLedger.findById(publisher).lean()).entries.length,1);
    await FeedPost.updateOne({_id:readBack._id},{$push:{shares:{user:new mongoose.Types.ObjectId(),caption:"Share fixture"}}});
    const blockedAuthor=new mongoose.Types.ObjectId();
    await UserBlock.create({blocker:publisher,blocked:blockedAuthor});
    await FeedPost.create([
      {author:publisher,text:"Hidden fixture",postType:"Need Help",topic:"Housing",location:"Fixture City",hiddenBy:[{user:publisher}],publishedAt:new Date()},
      {author:blockedAuthor,text:"Blocked fixture",postType:"Need Help",topic:"Housing",location:"Fixture City",publishedAt:new Date()},
      {author:publisher,text:"Private fixture",postType:"Need Help",topic:"Housing",location:"Fixture City",visibility:"private",publishedAt:new Date()},
    ]);
    const now=Date.now();
    await FeedPost.create([
      {author:publisher,text:"Expired fixture",postType:"Need Help",topic:"Housing",location:"Fixture City",rightNow:true,publishedAt:new Date(now-86400001)},
      {author:publisher,text:"Ended fixture",postType:"Event",topic:"Housing",location:"Fixture City",publishedAt:new Date(now-7*86400000-1)},
      {author:publisher,text:"Resolved fixture",postType:"Question",topic:"Housing",location:"Fixture City",resolvedAt:new Date(),publishedAt:new Date()},
    ]);
    const counts=response();
    await getWallNeedCounts({user:{_id:publisher},query:{scope:"custom",location:"Fixture City"}},counts,(value)=>{error=value;});
    assert.ifError(error);
    assert.equal(counts.body.data.counts.buy_sell,1);
    assert.equal(counts.body.data.counts.offering,0);
    assert.equal(counts.body.data.topicCounts.housing,1);
    assert.equal(counts.body.data.counts.need_help,0);
    assert.equal(counts.body.data.counts.event,0);
  } finally { await mongoose.disconnect(); await server.stop(); }
});
