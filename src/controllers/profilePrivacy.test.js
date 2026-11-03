import test from 'node:test';
import assert from 'node:assert/strict';
import CreatorProfile from '../models/CreatorProfile.js';
import FanProfile from '../models/FanProfile.js';
import {updateMyPrivacySettings} from './profileController.js';

test('approved creator privacy writes and reads the same Creator profile even with fan role',async t=>{
  const stored={privacySettings:{showOnlineStatus:false,messageAudience:'everyone',allowDirectMessages:true}};
  let writes=0;
  t.mock.method(FanProfile,'updateOne',()=>{throw new Error('Wrong profile model');});
  t.mock.method(CreatorProfile,'updateOne',async(_filter,update)=>{
    writes++;
    assert.equal(update.$set.privacySettings,undefined);
    for(const [key,value] of Object.entries(update.$set)) if(key.startsWith('privacySettings.')) stored.privacySettings[key.slice(16)]=value;
  });
  t.mock.method(CreatorProfile,'findOneAndUpdate',async()=>stored);
  const user={_id:'000000000000000000000001',role:'fan',creatorApprovalStatus:'approved'};
  for(const audience of ['following','no_one','everyone']) {
    let body;
    await updateMyPrivacySettings({user,body:{privacySettings:{messageAudience:audience}}},{status(){return this;},json(result){body=result;}},error=>{throw error;});
    assert.equal(body.data.privacySettings.messageAudience,audience);
    assert.equal(body.data.privacySettings.showOnlineStatus,false);
    assert.equal(body.data.privacySettings.allowDirectMessages,audience!=='no_one');
  }
  assert.equal(writes,3);
});
