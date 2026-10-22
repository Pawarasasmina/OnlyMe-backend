import test from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { uploadFeedPostVoice } from "./feedPostMediaStorageService.js";
test("Wall rejects measured audio above 30 seconds and removes the uploaded asset", async (t) => {
  const previous=[env.cloudinaryCloudName,env.cloudinaryApiKey,env.cloudinaryApiSecret];
  [env.cloudinaryCloudName,env.cloudinaryApiKey,env.cloudinaryApiSecret]=["fixture","fixture","fixture"];
  t.after(()=>{[env.cloudinaryCloudName,env.cloudinaryApiKey,env.cloudinaryApiSecret]=previous;});
  t.mock.method(cloudinary.uploader,"upload",async()=>({public_id:"fixture_voice",duration:30.1}));
  const destroyed=t.mock.method(cloudinary.uploader,"destroy",async()=>({result:"ok"}));
  await assert.rejects(uploadFeedPostVoice({file:{path:"nonexistent-fixture.webm",size:10},postId:"fixture",userId:"fixture"}),/30 seconds/);
  assert.equal(destroyed.mock.callCount(),1);
});
test("a measured 30-second Wall recording retains transcript and language", async (t) => {
  const previous=[env.cloudinaryCloudName,env.cloudinaryApiKey,env.cloudinaryApiSecret];
  [env.cloudinaryCloudName,env.cloudinaryApiKey,env.cloudinaryApiSecret]=["fixture","fixture","fixture"];
  t.after(()=>{[env.cloudinaryCloudName,env.cloudinaryApiKey,env.cloudinaryApiSecret]=previous;});
  t.mock.method(cloudinary.uploader,"upload",async()=>({public_id:"fixture_voice",duration:30,secure_url:"https://example.invalid/audio",format:"webm",bytes:10}));
  const media=await uploadFeedPostVoice({file:{path:"nonexistent-fixture.webm",size:10,mimetype:"audio/webm"},postId:"fixture",userId:"fixture",transcript:"Help please",transcriptLanguage:"en"});
  assert.equal(media.duration,30);
  assert.equal(media.transcript,"Help please");
  assert.equal(media.transcriptLanguage,"en");
});
