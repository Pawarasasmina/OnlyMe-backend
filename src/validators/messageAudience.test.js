import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettingsPayload} from './profileValidator.js';
test('message audience supports all three values and synchronizes legacy boolean',()=>{
  for (const audience of ['everyone','following','no_one']) {
    const result=validateSettingsPayload('fan','privacy',{privacySettings:{messageAudience:audience}});
    assert.equal(result.privacySettings.messageAudience,audience);
    assert.equal(result.privacySettings.allowDirectMessages,audience!=='no_one');
  }
  assert.throws(()=>validateSettingsPayload('fan','privacy',{privacySettings:{messageAudience:'invalid'}}));
  assert.equal(validateSettingsPayload('creator','privacy',{privacySettings:{allowDirectMessages:false}}).privacySettings.messageAudience,'no_one');
});
