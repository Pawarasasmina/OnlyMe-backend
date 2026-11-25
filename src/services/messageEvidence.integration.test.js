import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { v2 as cloudinary } from "cloudinary";
import Message from "../models/Message.js";
import User from "../models/User.js";
import MessageReport from "../models/MessageReport.js";
import GroupMessage from "../models/GroupMessage.js";
import GroupConversation from "../models/GroupConversation.js";
import { reportGroupMessage } from "../controllers/groupMessageController.js";
import { reportMessage, reportConversation, consumeDisappearingMessage } from "../controllers/messageController.js";
import { getReportForModeration } from "../controllers/adminController.js";
import { getUnifiedReport } from "../controllers/adminOperationsController.js";
import { freezeMessageEvidence, withMessageEvidenceUrls } from "./messageEvidenceService.js";

async function call(handler,req) {
  let data,error;
  await handler(req,{req,status(){return this;},json(body){data=body.data;return this;}},e=>{error=e;});
  if(error) throw error;
  return data;
}

test("failed evidence copies fail closed and remove partial copies",async()=>{
  const upload=cloudinary.uploader.upload,destroy=cloudinary.uploader.destroy;
  let count=0;const removed=[];
  cloudinary.uploader.upload=async(_url,options)=>{if(++count===2)throw Error("storage unavailable");return {public_id:options.public_id,format:"png"};};
  cloudinary.uploader.destroy=async id=>removed.push(id);
  try {
    await assert.rejects(freezeMessageEvidence({image:{assetId:"one",format:"png"},audio:{assetId:"two",format:"webm"}},"report"),error=>error.code==="EVIDENCE_CAPTURE_FAILED");
    assert.equal(removed.length,1);assert.match(removed[0],/private\/report-evidence\/report/);
  } finally {cloudinary.uploader.upload=upload;cloudinary.uploader.destroy=destroy;}
});

test("reported disappearing images, voice notes and video circles survive chat purge in both admin views",{skip:process.env.EVIDENCE_INTEGRATION!=="1",timeout:120000},async()=>{
  const server=await MongoMemoryServer.create({binary:{version:"8.2.6"}});
  const upload=cloudinary.uploader.upload;const copies=[];
  cloudinary.uploader.upload=async(url,options)=>{copies.push({url,options});return {public_id:options.public_id,format:options.resource_type==="image"?"png":"mp4",bytes:128,etag:"frozen-etag"};};
  try {
    await mongoose.connect(server.getUri());await MessageReport.init();
    const make=name=>User.create({name,username:`evidence.${name}`,email:`${name}@evidence.test`,password:"Password123!",role:"fan",status:"active"});
    const [sender,recipient,outsider]=await Promise.all([make("sender"),make("recipient"),make("outsider")]);
    const admin={_id:new mongoose.Types.ObjectId(),role:"admin"};
    for(const kind of ["image","audio","video"]) {
      const message=await Message.create({sender:sender._id,recipient:recipient._id,body:`Original ${kind}`,mediaType:kind,[kind]:{assetId:`original/${kind}`,resourceType:kind==="image"?"image":"video",format:kind==="image"?"png":"mp4"},disappearAfterSeconds:0,openedAt:new Date(),expiresAt:new Date(Date.now()+60000)});
      const req={user:recipient,params:{messageId:String(message._id)},body:{reason:"HARASSMENT"},headers:{},app:{get:()=>null}};
      await assert.rejects(call(reportMessage,{...req,user:outsider}),/Message not found/);
      const {reportId}=await call(reportMessage,req);
      const frozen=await MessageReport.findById(reportId).select("+snapshot").lean();
      assert.equal(frozen.snapshot.evidenceVersion,1);assert.ok(frozen.snapshot.frozenAt);
      assert.notEqual(frozen.snapshot[kind].assetId,message[kind].assetId);
      assert.match(frozen.snapshot[kind].assetId,/private\/report-evidence/);
      assert.equal(frozen.snapshot.context.find(row=>row.reported)[kind].assetId,frozen.snapshot[kind].assetId,"same source copied once per report");
      await assert.rejects(call(reportMessage,req),/already reported/);
      await call(consumeDisappearingMessage,req);
      const purged=await Message.findById(message._id).lean();
      assert.equal(purged.body,"Disappearing message");assert.ok(!purged[kind]?.assetId);
      await assert.rejects(call(reportMessage,{...req,user:sender}),/Message not found/);
      await MessageReport.updateOne({_id:reportId},{$set:{snapshot:{body:"tampered"},status:"REVIEWING"}});
      const detail=await call(getReportForModeration,{user:admin,params:{reportId},reportScopes:["MESSAGE"],headers:{}});
      assert.equal(detail.report.snapshot.body,`Original ${kind}`);
      assert.match(detail.report.snapshot[kind].url,/authenticated/);
      const unified=await call(getUnifiedReport,{user:admin,params:{model:"MessageReport",id:reportId},headers:{}});
      assert.equal(unified.report.snapshot[kind].assetId,frozen.snapshot[kind].assetId);
      assert.ok(unified.report.snapshot[kind].url);
    }
    assert.equal(copies.length,3,"copies are independent and context is deduplicated");
    const expired=await Message.create({sender:sender._id,recipient:recipient._id,body:"Expired secret",expiresAt:new Date(Date.now()-1000),mediaType:"audio",audio:{assetId:"expired/voice",format:"mp4"}});
    const active=await Message.create({sender:sender._id,recipient:recipient._id,body:"Conversation voice",mediaType:"audio",audio:{assetId:"active/voice",format:"mp4"}});
    const conversation=await call(reportConversation,{user:recipient,params:{userId:String(sender._id)},body:{reason:"HARASSMENT"},headers:{}});
    const conversationEvidence=await MessageReport.findById(conversation.reportId).select("+snapshot").lean();
    assert.equal(conversationEvidence.snapshot.messages.length,1);
    assert.equal(conversationEvidence.snapshot.messages[0].messageId,String(active._id));
    assert.ok(!JSON.stringify(conversationEvidence.snapshot).includes(String(expired._id)));
    assert.match(conversationEvidence.snapshot.messages[0].audio.assetId,/report-evidence/);
    const group=await GroupConversation.create({name:"Evidence group",createdBy:sender._id,admins:[sender._id],members:[sender._id,recipient._id]});
    const groupMessage=await GroupMessage.create({group:group._id,sender:sender._id,body:"Group circle",mediaType:"video",video:{assetId:"group/circle",format:"mp4"}});
    const groupReport=await call(reportGroupMessage,{user:recipient,params:{messageId:String(groupMessage._id)},body:{reason:"HARASSMENT"},headers:{}});
    const groupEvidence=await MessageReport.findById(groupReport.reportId).select("+snapshot").lean();
    assert.match(groupEvidence.snapshot.video.assetId,/report-evidence/);
    assert.equal(groupEvidence.snapshot.groupId,String(group._id));
    const legacy=withMessageEvidenceUrls({scope:"MESSAGE",snapshot:{audio:{assetId:"legacy/voice",format:"mp4"}}});
    assert.ok(legacy.snapshot.audio.url);assert.equal(legacy.snapshot.evidenceVersion,undefined);
  } finally {
    cloudinary.uploader.upload=upload;
    await mongoose.disconnect();await server.stop();
  }
});
