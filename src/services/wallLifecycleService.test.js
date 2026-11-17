import test from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, wallClosedReason, wallExpiresAt, wallNeedsExpiryPrompt, wallCanBump, wallActiveExpression, wallLifecycleStatus } from "./wallLifecycleService.js";
import { serializePost } from "../controllers/postController.js";
import { serializePostSearchResult } from "./searchService.js";
const now = Date.parse("2026-06-01T12:00:00Z");
const note = (postType, days, extra = {}) => ({ _id: "note", author: { _id: "owner" }, status: "published", postType, publishedAt: new Date(now - days * DAY_MS), ...extra });
// Evaluate the Mongo operators used by the actual feed predicate to verify parity with API status.
function evaluate(value, post) {
 if (typeof value === "string" && value.startsWith("$")) return post[value.slice(1)];
 if (!value || typeof value !== "object" || value instanceof Date) return value;
 if (Array.isArray(value)) return value.map(v => evaluate(v, post));
 const [op, args] = Object.entries(value)[0]; const e = v => evaluate(v, post);
 switch (op) {
 case "$ifNull": return e(args[0]) ?? e(args[1]);
 case "$and": return args.every(v => e(v));
 case "$or": return args.some(v => e(v));
 case "$eq": return e(args[0]) === e(args[1]);
 case "$ne": return e(args[0]) !== e(args[1]);
 case "$gt": return e(args[0]) > e(args[1]);
 case "$cond": return e(args[0]) ? e(args[1]) : e(args[2]);
 case "$switch": { const branch = args.branches.find(b => e(b.case)); return branch ? e(branch.then) : e(args.default); }
 default: throw Error(op);
 }
}
test("every category expires at its boundary and API/feed expressions agree", () => {
 for (const [type, days, reason] of [["Need Help",7,"expired"],["Looking for",14,"expired"],["Question",30,"expired"],["Buy & Sell",30,"expired"],["Offering",30,"expired"],["Recommendation",104,"outdated"],["Event",7,"ended"],["Right Now",1,"expired"]]) {
  for (const delta of [-1,0,1]) {
   const post = note(type, days, { publishedAt: new Date(now - days * DAY_MS - delta) });
   assert.equal(wallClosedReason(post,now), delta < 0 ? "" : reason, type);
   assert.equal(evaluate(wallActiveExpression(new Date(now)),post), delta < 0, type);
  }
 }
});
test("Right now overrides all categories, suppressing prompts even before expiry", () => {
 for (const type of ["Need Help", "Offering", "Recommendation", "Event"]) {
  const post=note(type,1,{rightNow:true}); assert.equal(wallClosedReason(post,now),"expired"); assert.equal(wallNeedsExpiryPrompt(post,now),false); assert.equal(wallCanBump(post,now),false);
 }
 assert.equal(wallNeedsExpiryPrompt(note("Event",6.5),now),false);
 assert.equal(wallClosedReason(note("",1,{context:"RIGHT_NOW"}),now),"expired");
});
test("author prompt windows match the prototype and renewals reset expiry", () => {
 for (const [type, threshold] of [["Need Help",6],["Looking for",13],["Question",29],["Buy & Sell",14],["Offering",14],["Recommendation",90]]) {
  assert.equal(wallNeedsExpiryPrompt(note(type,threshold-0.01),now),false,type);
  assert.equal(wallCanBump(note(type,threshold),now),true,type);
  assert.equal(wallCanBump(note(type,threshold,{bumpCount:3}),now),false,type);
  const kept=note(type,threshold,{bumpedAt:new Date(now),bumpCount:1});
  assert.equal(wallNeedsExpiryPrompt(kept,now),false,type);
  assert.ok(wallExpiresAt(kept)>new Date(now));
 }
 assert.equal(wallNeedsExpiryPrompt(note("Need Help",7),now),false);
 assert.equal(wallCanBump(note("Need Help",6,{bumpedAt:new Date(now-6*DAY_MS),bumpCount:1}),now),false);
});
test("manual closures keep category status and never prompt", () => {
 for (const [type,status] of [["Buy & Sell","sold"],["Recommendation","outdated"],["Event","ended"],["Offering","unavailable"],["Question","solved"]]) {
  const post=note(type,1,{resolvedAt:new Date(now)}); assert.equal(wallLifecycleStatus(post,now),status); assert.equal(wallNeedsExpiryPrompt(post,now),false); assert.equal(evaluate(wallActiveExpression(new Date(now)),post),false);
 }
});
test("profile/detail serialization and search preserve the same closed status", () => {
 const post=note("Recommendation",105,{publishedAt:new Date(Date.now()-105*DAY_MS)});
 const profile=serializePost(post,{_id:"owner"}); const search=serializePostSearchResult(post,"", "owner");
 assert.equal(profile.isClosed,true); assert.equal(profile.closedReason,"outdated"); assert.equal(profile.canBump,false);
 assert.equal(search.metadata.closedReason,profile.closedReason); assert.equal(search.metadata.lifecycleStatus,profile.lifecycleStatus); assert.equal(search.metadata.expiresAt.getTime(),profile.expiresAt.getTime());
});
