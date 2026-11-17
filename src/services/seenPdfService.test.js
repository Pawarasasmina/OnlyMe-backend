import assert from "node:assert/strict";
import test from "node:test";
import { buildSeenPdf } from "./seenPdfService.js";

test("buildSeenPdf creates a watermarked multi-chapter PDF", () => {
  const pdf = buildSeenPdf({
    publication: {
      publishedSnapshot: {
        metadata: { title: "A Better Morning", summary: "A small practical guide." },
        chapters: [
          { title: "Start", blocks: [{ order: 1, type: "TEXT", text: "Make one clear choice." }] },
          { title: "Continue", blocks: [{ order: 1, type: "KEY_POINT", text: "Keep the next step small." }] },
        ],
      },
    },
    viewer: { username: "reader" },
  });
  const source = pdf.toString("latin1");
  assert.equal(source.startsWith("%PDF-1.4"), true);
  assert.match(source, /A Better Morning/u);
  assert.match(source, /Personal copy for @reader/u);
  assert.match(source, /Chapter 2: Continue/u);
  assert.match(source, /%%EOF$/u);
});

