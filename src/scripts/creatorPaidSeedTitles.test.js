import test from "node:test";
import assert from "node:assert/strict";
import { CREATOR_PAID_TOPICS, creatorPaidTitle, paidSeedTitleRepair, PAID_SEED_SOURCE } from "./creatorPaidSeedTitles.js";

test("all creator paid Seen titles are distinct, including creators in the same category", () => {
  const titles = Object.values(CREATOR_PAID_TOPICS).flat();
  assert.equal(new Set(titles.map(title => title.toLowerCase())).size, titles.length);
  assert.notEqual(creatorPaidTitle("kenji@gmail.com", 0), creatorPaidTitle("liam@gmail.com", 0));
  assert.notEqual(creatorPaidTitle("chloe@gmail.com", 0), creatorPaidTitle("maya@gmail.com", 0));
  assert.throws(() => creatorPaidTitle("unrelated@example.com", 0));
});

function fixture() {
  const title = "The Stronger Week Blueprint";
  const snapshot = () => ({ metadata: { title, summary: `A focused premium guide to ${title.toLowerCase()}.` }, chapters: [{ blocks: [{ text: `Kenji introduces ${title.toLowerCase()} with one useful idea you can apply today.` }, { text: "An edited block stays unchanged." }] }] });
  return { _id: "existing-publication", seedSource: PAID_SEED_SOURCE, kind: "SEEN", title, summary: `A focused premium guide to ${title.toLowerCase()}.`, pricing: { starsAmount: 190 }, submittedSnapshot: snapshot(), publishedSnapshot: snapshot() };
}
const options = { oldTitle: "The Stronger Week Blueprint", title: creatorPaidTitle("kenji@gmail.com", 0), firstName: "Kenji" };

test("repair updates titles and generated preview text without changing IDs, prices or access", () => {
  const publication = fixture();
  const before = structuredClone(publication);
  const repair = paidSeedTitleRepair(publication, options);
  assert.deepEqual(publication, before);
  assert.equal(repair.fields.title, options.title);
  assert.equal(repair.fields["publishedSnapshot.metadata.title"], options.title);
  assert.ok(repair.fields["publishedSnapshot.chapters.0.blocks.0.text"].includes(options.title.toLowerCase()));
  assert.ok(!Object.keys(repair.fields).some(key => /_id|pricing|creator|entitlement|owner|blocks\.1/.test(key)));
});

test("repair skips custom titles, foreign content, edited snapshots and already-repaired content", () => {
  for (const change of [p => { p.title = "My own title"; }, p => { p.seedSource = "other"; }, p => { p.publishedSnapshot.metadata.title = "Edited title"; }, p => { p.title = options.title; }]) {
    const publication = fixture(); change(publication);
    assert.equal(paidSeedTitleRepair(publication, options), null);
  }
});

test("showcase experience repair uses creator attribution and preserves custom content", () => {
  const title = "Fitness Foundations";
  const publication = { seedSource: "client-showcase-v1", kind: "EXPERIENCE", title, publishedSnapshot: { metadata: { title }, chapters: [{ blocks: [{ text: "Kenji introduces the purpose of Fitness Foundations and the outcome you will build toward." }] }] } };
  const options = { oldTitle: title, title: "Kenji's Fitness Foundations", firstName: "Kenji", foundation: true };
  const repair = paidSeedTitleRepair(publication, options);
  assert.equal(repair.fields.title, options.title);
  assert.equal(repair.fields["publishedSnapshot.chapters.0.blocks.0.text"], "Kenji introduces the purpose of Kenji's Fitness Foundations and the outcome you will build toward.");
  assert.equal(paidSeedTitleRepair({ ...publication, title: options.title }, options), null);
});
