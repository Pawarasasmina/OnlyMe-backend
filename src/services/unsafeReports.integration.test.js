import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../models/User.js";
import FeedPost from "../models/FeedPost.js";
import MessageReport from "../models/MessageReport.js";
import PlatformSetting from "../models/PlatformSetting.js";
import { reportFeedPost } from "../controllers/postController.js";
import { getUnifiedReport, enforceUser, updateModerationPolicy } from "../controllers/adminOperationsController.js";
import { protect } from "../middleware/authMiddleware.js";
import { env } from "../config/env.js";
import { normalizeMeetupPolicy, refreshUnsafeAccountRestriction } from "./unsafeReportService.js";
async function call(handler,req){let data,error;const res={req,status(){return this;},json(body){data=body.data;return this;}};await handler(req,res,e=>{error=e;});if(error)throw error;return data;}

test("unsafe meet-up reports have a four-hour cap, independent reporter threshold and reversible account restriction",{skip:process.env.MEETUP_INTEGRATION!=="1",timeout:120000},async()=>{
  const server=await MongoMemoryServer.create({binary:{version:"8.2.6"}});
  try{
    await mongoose.connect(server.getUri());
    await MessageReport.init();
    await PlatformSetting.create({key:"moderation-policy",value:{urgentHours:24,unsafeUrgentHours:24,unsafeReportThreshold:3,unsafeRestrictionDays:1}});
    const make=(name,type="REAL")=>User.create({name,username:`meetup.${name}`,email:`${name}@meetup.test`,password:"Password123!",status:"active",role:"fan",accountType:type,createdAt:new Date(Date.now()-20*86400000)});
    const author=await make("author");const reporters=await Promise.all([make("one"),make("two"),make("three"),make("test","TEST")]);
    const post=await FeedPost.create({author:author._id,postType:"Company",text:"Company for coffee at a public place",location:"Dubai, UAE",status:"published",visibility:"public",publishedAt:new Date()});
    const req=user=>({user,params:{id:String(post._id)},body:{reason:"UNSAFE_MEETUP"},query:{},headers:{},app:{get:()=>null}});
    await call(reportFeedPost,req(reporters[0]));
    const first=await MessageReport.findOne({reporter:reporters[0]._id});
    assert.equal(first.priority,"URGENT");assert.ok(first.dueAt-first.createdAt<=4*3600000);assert.ok(first.dueAt-first.createdAt>0);
    await assert.rejects(call(reportFeedPost,req(reporters[0])),/already reported/);
    await call(reportFeedPost,req(reporters[3]));
    await call(reportFeedPost,req(reporters[1]));
    assert.equal((await User.findById(author._id)).unsafeRestrictedUntil,null,"test reporters do not contribute to an account restriction");
    await call(reportFeedPost,req(reporters[2]));
    let current=await User.findById(author._id);assert.ok(current.unsafeRestrictedUntil>new Date());assert.equal(current.authVersion,1);
    const token=jwt.sign({sub:String(author._id),authVersion:1},env.accessSecret);
    await assert.rejects(call(protect,{headers:{authorization:`Bearer ${token}`},cookies:{}}),error=>error.code==="MEETUP_SAFETY_RESTRICTED");
    // A dismissed report removes its contribution without touching manual restrictions.
    first.status="RESOLVED";first.resolution={action:"NO_ACTION",falseReport:true,note:"Reviewed and dismissed"};await first.save();
    assert.equal((await User.findById(author._id)).unsafeRestrictedUntil,null);
    first.status="RECEIVED";first.resolution={};await first.save();
    assert.ok((await User.findById(author._id)).unsafeRestrictedUntil>new Date());
    const admin=await User.create({name:"Admin",username:"meetup.admin",email:"admin@meetup.test",password:"Password123!",role:"admin",adminRole:"MAIN_ADMIN"});
    await call(enforceUser,{user:admin,adminRole:"MAIN_ADMIN",params:{id:String(author._id)},body:{action:"LIFT_MEETUP_RESTRICTION",reason:"Safety review complete"},app:{get:()=>null},get:()=>"test"});
    current=await User.findById(author._id);assert.equal(current.unsafeRestrictedUntil,null);assert.ok(current.unsafeRestrictionLiftedAt);
    await refreshUnsafeAccountRestriction(author._id);assert.equal((await User.findById(author._id)).unsafeRestrictedUntil,null,"old reports do not immediately reapply a lifted restriction");
    assert.equal(normalizeMeetupPolicy({unsafeUrgentHours:99}).unsafeUrgentHours,4);
    const detail=await call(getUnifiedReport,{user:admin,params:{model:"MessageReport",id:String(first._id)}});assert.equal(detail.report.priority,"URGENT");
    const policy=await call(updateModerationPolicy,{user:admin,adminRole:"MAIN_ADMIN",body:{unsafeUrgentHours:10,unsafeReportThreshold:1,reason:"Test policy caps"}});assert.equal(policy.policy.unsafeUrgentHours,4);assert.equal(policy.policy.unsafeReportThreshold,3);
  }finally{await mongoose.disconnect();await server.stop();}
});
