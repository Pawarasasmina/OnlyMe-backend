import test from "node:test";
import assert from "node:assert/strict";
import { assertPrivateStorageConfiguration, inspectVerificationFile } from "./privateDocumentStorageService.js";
import { env } from "../config/env.js";

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

test("rejects verification storage nested inside public uploads", () => {
  const original = env.verificationStorageRoot;
  try {
    env.verificationStorageRoot = "./uploads/private-verifications";
    assert.throws(() => assertPrivateStorageConfiguration(), /must not be inside/);
  } finally {
    env.verificationStorageRoot = original;
  }
});
