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
  assert.equal(metadata.transform.scale, 2.2);
  assert.equal(metadata.transform.translateX, -35);
  assert.equal(metadata.textOverlays.length, 10);
  assert.equal(metadata.textOverlays[0].x, 100);
  assert.equal(metadata.textOverlays[0].fontSize, 54);
  assert.equal(metadata.textOverlays[0].color, "#FFFFFF");
});

test("story audience and interaction settings are parsed explicitly", () => {
  assert.deepEqual(parseStoryOptions({ audience: "close_circle", allowReactions: "false", allowReplies: "true", allowSharing: "false" }), {
    audience: "close_circle",
    allowReactions: false,
    allowReplies: true,
    allowSharing: false,
  });
});
