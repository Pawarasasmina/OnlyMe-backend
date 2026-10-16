import assert from "node:assert/strict";
import test from "node:test";
import { searchLiveLocations } from "./locationSearchService.js";

test("current area reverse lookup works without typed text and returns a city rather than a street", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = new URL(url);
    return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: [79.8612, 6.9271] }, properties: { name: "A private address", street: "Sample Street", housenumber: "42", city: "Colombo", state: "Western Province", country: "Sri Lanka", countrycode: "lk" } }] }) };
  });
  const results = await searchLiveLocations({ latitude: 6.9271, longitude: 79.8612 });
  assert.equal(requested.pathname, "/reverse");
  assert.equal(requested.searchParams.get("lat"), "6.9271");
  assert.equal(requested.searchParams.has("q"), false);
  assert.equal(results[0].name, "Colombo");
  assert.equal(results[0].code, "LK");
  assert.ok(!results[0].label.includes("Street"));
  assert.ok(!results[0].label.includes("private"));
});

test("typed location searches keep the existing forward search and coordinate bias", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => { requested = new URL(url); return { ok: true, json: async () => ({ features: [] }) }; });
  await searchLiveLocations({ query: "Galle", latitude: 0, longitude: 0 });
  assert.equal(requested.pathname, "/api");
  assert.equal(requested.searchParams.get("q"), "Galle");
  assert.equal(requested.searchParams.get("lat"), "0");
  await searchLiveLocations({ query: "Kandy", latitude: "", longitude: null });
  assert.equal(requested.searchParams.has("lat"), false);
});

test("missing or invalid coordinates never become a lookup at zero degrees", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected lookup"); });
  for (const position of [{}, { latitude: "", longitude: "" }, { latitude: null, longitude: null }, { latitude: 91, longitude: 80 }, { latitude: 7, longitude: 181 }]) {
    assert.deepEqual(await searchLiveLocations(position), []);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("reverse lookup service failures return an actionable availability error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("timeout"); });
  await assert.rejects(searchLiveLocations({ latitude: 6.9, longitude: 79.8 }), { statusCode: 503 });
});
