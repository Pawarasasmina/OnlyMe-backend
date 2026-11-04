import Conversation from "../models/Conversation.js";
import GroupConversation from "../models/GroupConversation.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import PublicationPreference from '../models/PublicationPreference.js';
import { listMyMutedAccounts, unmuteAccount } from './profileController.js';

const userId='000000000000000000000001';
const creatorId='000000000000000000000002';
function response() {
  return {status(){return this;},json(body){this.body=body;return this;}};
}
const fail=error=>{throw error;};

test('Settings includes story-muted accounts and deduplicates accounts muted in both places',async t=>{
  t.mock.method(Conversation,'find',()=>({populate(){return this;},async lean(){return [{participants:[{_id:userId},{_id:creatorId,name:'Chloe',username:'chloe'}]}];}}));
  t.mock.method(GroupConversation,'find',()=>({select(){return this;},async lean(){return [{_id:'000000000000000000000003',name:'Muted circle'}];}}));
  const creator={_id:creatorId,name:'Chloe',username:'chloe',avatar:'/chloe.png'};
  let filter;
  t.mock.method(PublicationPreference,'find',query=>{
    filter=query;
    return {sort(){return this;},populate(){return this;},async lean(){return [
      {_id:'story-mute',creator,type:'HIDDEN_STORY_CREATOR'},
      {_id:'account-mute',creator,type:'MUTED_CREATOR'},
      {_id:'deleted-account',creator:null,type:'HIDDEN_STORY_CREATOR'},
    ];}};
  });
  const res=response();
  await listMyMutedAccounts({user:{_id:userId}},res,fail);
  assert.deepEqual(filter,{user:userId,type:{$in:['MUTED_CREATOR','HIDDEN_STORY_CREATOR']}});
  assert.equal(res.body.data.items.length,2);
  assert.deepEqual(res.body.data.items[0].muteTypes,["stories","posts","messages"]);
  assert.equal(res.body.data.items[1].kind,"group");
  assert.equal(res.body.data.items[0].displayName,'Chloe');
});

test('Unmute clears both story and account mutes for only the requesting user',async t=>{
  let conversationFilter, groupFilter;
  t.mock.method(Conversation,'updateMany',async (query,update)=>{conversationFilter=query;assert.deepEqual(update,{$pull:{mutedBy:userId}});});
  t.mock.method(GroupConversation,'updateOne',async (query,update)=>{groupFilter=query;assert.deepEqual(update,{$pull:{mutedBy:userId}});});
  let filter;
  t.mock.method(PublicationPreference,'deleteMany' ,async query=>{filter=query;return {deletedCount:2};});
  const res=response();
  await unmuteAccount({user:{_id:userId},params:{userId:creatorId}},res,fail);
  assert.deepEqual(filter,{user:userId,creator:creatorId,type:{$in:['MUTED_CREATOR','HIDDEN_STORY_CREATOR']}});
  assert.equal(res.body.data.unmuted,true);
  assert.equal(conversationFilter.mutedBy,userId);
  assert.equal(groupFilter.members,userId);
  assert.equal(groupFilter._id,creatorId);
});
