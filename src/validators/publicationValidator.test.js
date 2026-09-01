import assert from "node:assert/strict";
import test from "node:test";
import { assertCompletePublication, normalizeChapter } from "./publicationValidator.js";

const chapter = (preview = true, text = "Valid chapter") => ({ title: "Chapter", isPreview: preview, blocks: [{ id: "b", type: "TEXT", text }] });
const publication = (kind, pricing) => ({ kind, title: "Title", summary: "Summary", category: "Category", pricing, coverMedia: { assetId: "verified-cover" } });

test("valid Seen is free with one to three public chapters", () => { assert.doesNotThrow(() => assertCompletePublication(publication("SEEN", { mode: "FREE", starsAmount: null }), [chapter()])); assert.throws(() => assertCompletePublication(publication("SEEN", { mode: "FREE", starsAmount: null }), [])); assert.throws(() => assertCompletePublication(publication("SEEN", { mode: "FREE", starsAmount: null }), [chapter(), chapter(), chapter(), chapter()])); assert.throws(() => assertCompletePublication(publication("SEEN", { mode: "ONE_TIME", starsAmount: 1 }), [chapter()])); });
test("World requires one to seven open chapters and stays free", () => { assert.doesNotThrow(() => assertCompletePublication(publication("WORLD", { mode: "FREE", starsAmount: null }), [chapter(true), chapter(true)])); assert.throws(() => assertCompletePublication(publication("WORLD", { mode: "ONE_TIME", starsAmount: 10 }), [chapter(true)])); assert.throws(() => assertCompletePublication(publication("WORLD", { mode: "FREE", starsAmount: null }), [chapter(true), chapter(false)])); assert.throws(() => assertCompletePublication(publication("WORLD", { mode: "FREE", starsAmount: null }), Array.from({ length: 8 }, () => chapter(true)))); });
test("Premium World enforces presets, previews, and a locked chapter", () => { assert.doesNotThrow(() => assertCompletePublication(publication("PREMIUM_WORLD", { mode: "MONTHLY", starsAmount: 190 }), [chapter(true), chapter(false)])); assert.throws(() => assertCompletePublication(publication("PREMIUM_WORLD", { mode: "MONTHLY", starsAmount: 100 }), [chapter(true), chapter(false)])); assert.throws(() => assertCompletePublication(publication("PREMIUM_WORLD", { mode: "MONTHLY", starsAmount: 90 }), [chapter(false), chapter(false)])); assert.throws(() => assertCompletePublication(publication("PREMIUM_WORLD", { mode: "MONTHLY", starsAmount: 90 }), [chapter(true), chapter(true)])); });
test("chapter blocks reject excessive text, unsafe links, and invalid types", () => { assert.throws(() => normalizeChapter(chapter(true, "x".repeat(2001)))); assert.throws(() => normalizeChapter({ title: "C", blocks: [{ id: "b", type: "LINK", label: "Bad", url: "javascript:alert(1)" }] })); assert.throws(() => normalizeChapter({ title: "C", blocks: [{ id: "b", type: "HTML", text: "bad" }] })); });
test("marker blocks accept exactly the six brand colors", () => { assert.equal(normalizeChapter({ title: "C", blocks: [{ id: "b", type: "HIGHLIGHT", text: "Marked", metadata: { color: "MINT" } }] }).blocks[0].metadata.color, "MINT"); assert.throws(() => normalizeChapter({ title: "C", blocks: [{ id: "b", type: "HIGHLIGHT", text: "Marked", metadata: { color: "PURPLE" } }] })); });
test("media blocks preserve story preview metadata", () => { const normalized = normalizeChapter({ title: "C", blocks: [{ id: "story-photo", type: "IMAGE", media: { assetId: "asset-1", mediaType: "IMAGE", resourceType: "image", secureUrl: "https://example.test/story.jpg" }, metadata: { label: "9:15 AM", storyPreview: true } }] }); assert.deepEqual(normalized.blocks[0].metadata, { label: "9:15 AM", storyPreview: true }); });

test("poll blocks preserve a validated question and unique choices", () => {
  const normalized = normalizeChapter({ title: "C", blocks: [{ id: "poll-1", type: "POLL", metadata: { question: "What next?", options: ["Ocean", "Forest"] } }] });
  assert.deepEqual(normalized.blocks[0].metadata, { question: "What next?", options: ["Ocean", "Forest"], resultsVisibility: "SUBSCRIBERS" });
});

test("poll blocks preserve creator-only result visibility", () => {
  const normalized = normalizeChapter({ title: "C", blocks: [{ id: "poll-1", type: "POLL", metadata: { question: "What next?", options: ["Ocean", "Forest"], resultsVisibility: "CREATOR" } }] });
  assert.equal(normalized.blocks[0].metadata.resultsVisibility, "CREATOR");
});

test("poll blocks reject duplicate or incomplete choices", () => {
  assert.throws(() => normalizeChapter({ title: "C", blocks: [{ id: "poll-1", type: "POLL", metadata: { question: "What next?", options: ["Ocean", "ocean"] } }] }), /unique/);
});
test("location key points preserve a safe location label", () => { const normalized = normalizeChapter({ title: "C", blocks: [{ id: "place", type: "KEY_POINT", text: "Sri Lanka", metadata: { location: { label: "Sri Lanka" } } }] }); assert.deepEqual(normalized.blocks[0].metadata, { location: { label: "Sri Lanka" } }); });
