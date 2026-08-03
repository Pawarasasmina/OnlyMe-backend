import test from "node:test";
import assert from "node:assert/strict";
import { inspectVerificationFile } from "./privateDocumentStorageService.js";

const fake = (originalName, mimetype, bytes) => {
  const buffer = Buffer.from(bytes);
  return { originalname: originalName, mimetype, buffer, size: buffer.length };
};

test("accepts a PDF with matching extension, MIME, and signature", () => {
  const result = inspectVerificationFile(fake("identity.pdf", "application/pdf", "%PDF-1.7 test"));
  assert.equal(result.mimeType, "application/pdf");
});

test("rejects a disguised executable", () => {
  assert.throws(() => inspectVerificationFile(fake("identity.pdf", "application/pdf", "MZ executable")), /content/);
});

test("rejects mismatched image metadata", () => {
  assert.throws(
    () => inspectVerificationFile(fake("identity.png", "image/png", [0xff, 0xd8, 0xff, 0x00])),
    /does not match/
  );
});
