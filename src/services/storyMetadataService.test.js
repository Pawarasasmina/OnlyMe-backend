import assert from "node:assert/strict";
import test from "node:test";
import { parseStoryEditorMetadata, parseStoryOptions } from "./storyMetadataService.js";

test("story editor metadata preserves safe text, stickers, drawings, and transforms", () => {
  const metadata = parseStoryEditorMetadata(JSON.stringify({
    transform: { scale: 1.5, translateX: 12, translateY: -8, rotation: 4 },
    textOverlays: [{ id: "heading", text: "Hello", color: "#FACC15", fontSize: 40, fontWeight: 800, align: "center", background: "pill", x: 45, y: 30 }],
    stickers: [{ id: "heart", value: "❤️", x: 70, y: 60, scale: 1.2, rotation: 10 }],
    drawing: [{ id: "line", color: "#8AB8FF", size: 2, points: [{ x: 2, y: 3 }, { x: 40, y: 80 }] }],
  }));
  assert.equal(metadata.textOverlays[0].text, "Hello");
  assert.equal(metadata.stickers[0].value, "❤️");
  assert.equal(metadata.drawing[0].points.length, 2);
  assert.equal(metadata.transform.scale, 1.5);
});

test("story metadata clamps unsafe visual values and limits collection sizes", () => {
  const metadata = parseStoryEditorMetadata({
    transform: { scale: 99, translateX: -999 },
    textOverlays: Array.from({ length: 20 }, (_, index) => ({ text: `Text ${index}`, x: 999, fontSize: 200, color: "red" })),
  });
  assert.equal(metadata.transform.scale, 4);
  assert.equal(metadata.transform.translateX, -35);
  assert.equal(metadata.textOverlays.length, 10);
  assert.equal(metadata.textOverlays[0].x, 105);
  assert.equal(metadata.textOverlays[0].fontSize, 96);
  assert.equal(metadata.textOverlays[0].color, "#FFFFFF");
});

test("story metadata preserves sanitized photo framing", () => {
  const metadata = parseStoryEditorMetadata({
    mediaFraming: { fitMode: "fit", scale: 0.4, translateX: 120, translateY: -120 },
  });
  assert.deepEqual(metadata.mediaFraming, {
    fitMode: "fit",
    scale: 0.4,
    translateX: 100,
    translateY: -100,
  });
});

test("story metadata preserves safe internal share cards and their position", () => {
  const metadata = parseStoryEditorMetadata({
    sharedCard: {
      destinationRoute: "/seen/66f1234567890abcdef1234",
      imageUrl: "https://cdn.example.com/cover.jpg",
      kind: "Seen",
      subtitle: "Creator · Tap to open",
      title: "Morning Espresso Ritual",
      x: 62,
      y: 44,
    },
  });
  assert.deepEqual(metadata.sharedCard, {
    destinationRoute: "/seen/66f1234567890abcdef1234",
    imageUrl: "https://cdn.example.com/cover.jpg",
    kind: "Seen",
    points: [],
    subtitle: "Creator · Tap to open",
    title: "Morning Espresso Ritual",
    variant: "compact",
    scale: 1,
    x: 62,
    y: 44,
  });
  assert.equal(parseStoryEditorMetadata({ sharedCard: { destinationRoute: "https://evil.example" } }).sharedCard, undefined);
  assert.equal(parseStoryEditorMetadata({ sharedCard: { destinationRoute: "/admin/users" } }).sharedCard, undefined);
  assert.deepEqual(parseStoryEditorMetadata({ sharedCard: { destinationRoute: "/posts/post-123", eyebrow: "Ethan · Right now · Dubai" } }).sharedCard, {
    destinationRoute: "/posts/post-123",
    eyebrow: "Ethan · Right now · Dubai",
    imageUrl: "",
    kind: "post",
    points: [],
    subtitle: "",
    title: "View post",
    variant: "compact",
    scale: 1,
    x: 50,
    y: 50,
  });
});

test("story metadata preserves question stickers for story replies", () => {
  const metadata = parseStoryEditorMetadata({
    questionSticker: {
      id: "question-main",
      prompt: "What should I cover next?",
      x: 50,
      y: 63,
    },
  });
  assert.deepEqual(metadata.questionSticker, {
    id: "question-main",
    prompt: "What should I cover next?",
    x: 50,
    y: 63,
  });
  assert.equal(parseStoryEditorMetadata({ questionSticker: { prompt: "x".repeat(100), x: 200, y: -20 } }).questionSticker.prompt.length, 60);
  assert.equal(parseStoryEditorMetadata({ questionSticker: { prompt: "x".repeat(100), x: 200, y: -20 } }).questionSticker.x, 105);
  assert.equal(parseStoryEditorMetadata({ questionSticker: { prompt: "x".repeat(100), x: 200, y: -20 } }).questionSticker.y, -2);
});

test("story audience and interaction settings are parsed explicitly", () => {
  assert.deepEqual(parseStoryOptions({ audience: "close_circle", allowReactions: "false", allowReplies: "true", allowSharing: "false" }), {
    audience: "close_circle",
    allowReactions: false,
    allowReplies: true,
    allowSharing: false,
  });
});

test("latest text formatting and near-edge placement survive a metadata round trip", () => {
  const result = parseStoryEditorMetadata(JSON.stringify({ flattened: true, textOverlays: [{ text: "First line\nSecond line", style: 5, backgroundMode: 2, rotation: -35, fontSize: 72, align: "right", x: -4, y: 101 }] }));
  const overlay = result.textOverlays[0];
  assert.equal(overlay.style, 5);
  assert.equal(overlay.backgroundMode, 2);
  assert.equal(overlay.rotation, -35);
  assert.equal(overlay.x, -4);
  assert.equal(overlay.y, 101);
  assert.equal(overlay.text, "First line\nSecond line");
  assert.equal(result.flattened, true);
  assert.equal(parseStoryEditorMetadata({ textOverlays: [{ text: "Legacy plate", style: 2 }] }).textOverlays[0].backgroundMode, 1);
});

test("mentions reject invalid identities, deduplicate and clamp transforms", () => {
  const userId = "507f1f77bcf86cd799439011";
  const result = parseStoryEditorMetadata({ mentions: [null, { userId: "fake" }, { userId, username: "forged", x: -999, y: 999, scale: Infinity, rotation: 999 }, { userId }] });
  assert.deepEqual(result.mentions, [{ userId, st: 0, x: -5, y: 102, scale: 1, rotation: 180 }]);
  assert.equal(parseStoryEditorMetadata({ mentions: [{ userId, st: 1 }] }).mentions[0].st, 1);
  assert.equal(parseStoryEditorMetadata({ mentions: [{ userId, st: "invalid" }] }).mentions[0].st, 0);
});

test("private audiences never silently become public", () => {
  assert.equal(parseStoryOptions({ audience: "friends" }).audience, "close_circle");
  assert.equal(parseStoryOptions({ audience: "world" }).audience, "world");
  for (const audience of ["followers", "close_circle", "only_me"]) assert.equal(parseStoryOptions({ audience }).audience, audience);
  assert.throws(() => parseStoryOptions({ audience: "private_typo" }), /Invalid story audience/);
});

test("question-answer cards and Wall translations retain their content", () => {
  assert.equal(parseStoryEditorMetadata({ sharedCard: { kind: "question_reply", title: "My answer", subtitle: "Question" } }).sharedCard.title, "My answer");
  const card = parseStoryEditorMetadata({ sharedCard: { destinationRoute: "/posts/note-1", kind: "voice_note", originalTranscript: "Original", translationText: "Translated", translationLabel: "English", displayMode: "text_only" } }).sharedCard;
  assert.equal(card.translationText, "Translated");
  assert.equal(card.originalTranscript, "Original");
  assert.equal(card.displayMode, "text_only");
  assert.doesNotThrow(() => parseStoryEditorMetadata({ textOverlays: [null], stickers: [null], drawing: [null] }));
});
