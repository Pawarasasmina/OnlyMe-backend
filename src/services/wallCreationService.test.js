import test from "node:test";
import assert from "node:assert/strict";
import { validateWallCreation, textHash } from "./wallCreationService.js";
import { wallClosedReason, DAY_MS } from "./wallLifecycleService.js";
import FeedPost from "../models/FeedPost.js";

const note = { postType: "Need Help", text: "Help please", rightNow: "false" };
test("creation rejects empty/photo-only, too many photos, invalid category/flag, long text and multiple links", () => {
  for (const [body, files] of [[{...note,text:""},{media:[{}]}],[note,{media:[{},{},{},{}]}],[{...note,postType:""},{}],[{...note,rightNow:"yes"},{}],[{...note,text:"x".repeat(2001)},{}],[{...note,text:"https://a.com www.b.com"},{}]]) assert.throws(() => validateWallCreation(body,files));
  assert.equal(validateWallCreation({...note,text:""},{voice:[{}]}), "");
  assert.equal(validateWallCreation({...note,text:" www.a.com "},{}), "www.a.com");
});
test("duplicate hashes ignore leading/trailing whitespace and case but not different content", () => {
  assert.equal(textHash(" Help ME "),textHash("help me"));
  assert.notEqual(textHash("help me"),textHash("help you"));
  assert.equal(textHash("   "),"");
});
test("purpose, topic and Right now remain independent and legacy records validate", async () => {
  const post = new FeedPost({author:"507f1f77bcf86cd799439011",text:"Selling",postType:"Buy & Sell",topic:"Housing",rightNow:true});
  await post.validate();
  assert.equal(post.postType,"Buy & Sell");
  assert.equal(post.topic,"Housing");
  const legacy = new FeedPost({author:post.author,text:"Old offer",postType:"Offering",topic:"Buy / Sell",media:[]});
  await legacy.validate();
  assert.equal(legacy.postType,"Offering");
});
test("closure boundaries agree for independent Right now, legacy notes, events and resolved notes", () => {
  const now=Date.now();
  for (const p of [{rightNow:true},{postType:"Right Now"},{context:"Right now"}]) {
    assert.equal(wallClosedReason({...p,publishedAt:new Date(now-DAY_MS+1)},now),"");
    assert.equal(wallClosedReason({...p,publishedAt:new Date(now-DAY_MS)},now),"expired");
  }
  assert.equal(wallClosedReason({postType:"Event",publishedAt:new Date(now-7*DAY_MS)},now),"ended");
  assert.equal(wallClosedReason({postType:"Offering",publishedAt:new Date(now-50*DAY_MS)},now),"");
  assert.equal(wallClosedReason({resolvedAt:new Date()},now),"resolved");
});
