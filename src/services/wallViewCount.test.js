import assert from "node:assert/strict";
import test from "node:test";
import { wallViewCount } from "./wallViewCount.js";
import { serializePost } from "../controllers/postController.js";
test("existing test-account views are visible without rewriting the database", () => {
 const post={author:"author",viewCount:0,views:[{user:"test",actorAccountType:"TEST"}]};
 assert.equal(wallViewCount(post),1);
});
test("regular and test viewers count once each, excluding own views", () => {
 assert.equal(wallViewCount({author:"author",viewCount:1,views:[{user:"author",actorAccountType:"TEST"},{user:"a"},{user:"a"},{user:"a",actorAccountType:"TEST"},{user:"b",actorAccountType:"TEST"},{user:"b",actorAccountType:"TEST"}]}),2);
});
test("legacy real counters are preserved and combined with recorded test viewers", () => {
 assert.equal(wallViewCount({viewCount:20,views:[{user:"b",actorAccountType:"TEST"}]}),21);
 assert.equal(wallViewCount({viewCount:0,views:[{user:"a"}]}),1);
 assert.equal(wallViewCount(),0);
});
test("serialized feed and detail responses show the total recorded views", () => {
 const post={_id:"507f1f77bcf86cd799439012",author:{_id:"507f1f77bcf86cd799439011",name:"Author"},comments:[],viewCount:0,views:[{user:"507f1f77bcf86cd799439013",actorAccountType:"TEST"}]};
 assert.equal(serializePost(post).viewCount,1);
});
