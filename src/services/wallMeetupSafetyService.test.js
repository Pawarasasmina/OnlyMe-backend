import test from "node:test";
import assert from "node:assert/strict";
import { assertWallLocationSafety, readWallArea, signWallArea } from "./wallMeetupSafetyService.js";
import { containsPreciseLocation, redactPreciseLocation } from "../utils/wallMeetupSafety.js";
import { serializePhotonArea } from "./locationSearchService.js";
import { protectPublicWallData } from "./responsePrivacyService.js";
import { validateWallCreation } from "./wallCreationService.js";

test("public Wall text, voice text and location reject private addresses, pins and live-map links", () => {
  for (const value of ["Meet at 42 Baker Street", "Come to apartment 407", "25.204812, 55.270834", "latitude: 25.2048", "https://maps.app.goo.gl/privatepin"]) {
    assert.equal(containsPreciseLocation(value), true, value);
    assert.throws(() => assertWallLocationSafety({ text:value }), error => error.code === "WALL_PRIVATE_LOCATION");
    assert.throws(() => assertWallLocationSafety({ voiceTranscript:value }), error => error.code === "WALL_PRIVATE_LOCATION");
    assert.throws(() => assertWallLocationSafety({ location:value }), error => error.code === "WALL_PRIVATE_LOCATION");
    assert.ok(!redactPreciseLocation(value).includes(value));
  }
  assert.doesNotThrow(() => assertWallLocationSafety({ text:"Coffee in Dubai Marina? Meet in a public place.",location:"Dubai, UAE" }));
});
test("area-only geocoder results contain no street, house number or coordinates and cannot be forged", () => {
  const result=serializePhotonArea({geometry:{coordinates:[55.270834,25.204812]},properties:{name:"Private residence",street:"Baker Street",housenumber:"42",district:"Marina",city:"Dubai",country:"UAE",countrycode:"AE"}});
  assert.equal(result.label,"Marina, Dubai, UAE");
  assert.equal(result.latitude,undefined);assert.equal(result.longitude,undefined);
  assert.deepEqual(result.mapCenter,{latitude:25.2,longitude:55.3});
  assert.equal(readWallArea(result.label,result.wallAreaToken,"AE"),result.label);
  assert.throws(()=>readWallArea("42 Baker Street",result.wallAreaToken,"AE"),/Choose a city/);
  assert.throws(()=>readWallArea(result.label,result.wallAreaToken.slice(0,-5)+"xxxxx","AE"),/Choose a city/);
  assert.equal(readWallArea("Private residence without a signed area",null,"AE"),"United Arab Emirates");
  assert.equal(readWallArea("A private residence"),"");
  assert.equal(readWallArea("Paris, France"),"Paris, France");
  assert.equal(readWallArea("District, City",signWallArea("District, City")),"District, City");
});
test("legacy public notes and search snippets are redacted at the API boundary", () => {
  const result=protectPublicWallData({items:[{id:"note",postType:"Company",text:"Meet at 42 Baker Street",location:"Private address",latitude:25.204812,longitude:55.270834,media:[{transcript:"Apartment 407"}]}]});
  const note=result.items[0];assert.equal(note.location,"");assert.equal(note.latitude,undefined);assert.equal(note.longitude,undefined);assert.ok(!note.text.includes("42 Baker"));assert.ok(!note.media[0].transcript.includes("407"));
  const search=protectPublicWallData({type:"post",title:"42 Baker Street",description:"Apartment 407"});assert.ok(!search.title.includes("42 Baker"));
});
test("Company notes are supported while B18 still rejects under-18 publishers", () => {
  const body={postType:"Company",text:"Company for coffee in a public place",location:"Dubai, UAE"};
  assert.doesNotThrow(()=>validateWallCreation(body,{}, {dateOfBirth:"1990-01-01"}));
  assert.throws(()=>validateWallCreation(body,{}, {dateOfBirth:"2012-01-01"}),error=>error.code==="MINIMUM_AGE_REQUIRED");
});
