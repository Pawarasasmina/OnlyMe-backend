import test from "node:test";
import assert from "node:assert/strict";
import { clearWallTranslationCache, wallTranslationMetadata, translateWallContent } from "./wallTranslationService.js";
import { detectTextLanguage } from "./translationService.js";
test.beforeEach(clearWallTranslationCache);

test("provider language detection is normalized on the backend", async () => {
  assert.equal(await detectTextLanguage("Hello", { translator: { detect: async () => ({ language: "en" }) } }), "en-US");
});
test("same-language regional variants do not offer translation", async () => {
  const result = await wallTranslationMetadata({ text: "Hello", preferredLanguage: "en-GB", detect: async () => "en-US" });
  assert.equal(result.canTranslate, false);
});
test("different viewer preferences produce the correct target language", async () => {
  const result = await wallTranslationMetadata({ text: "Hola", preferredLanguage: "fr", detect: async () => "es-ES" });
  assert.equal(result.targetLanguage, "fr-FR");
  assert.equal(result.sourceLanguageName, "Spanish");
  assert.equal(result.canTranslate, true);
});
test("only the text is translated and original detection is shared across viewers", async () => {
  let detectionCalls = 0;
  let translationCalls = 0;
  const detect = async () => { detectionCalls++; return "ar-SA"; };
  const translate = async (payload) => { translationCalls++; assert.deepEqual(payload, { text: "Original", sourceLanguage: "ar-SA", targetLanguage: "en-US" }); return { translatedText: "Translated" }; };
  const [one, two] = await Promise.all([translateWallContent({ text: "Original", preferredLanguage: "en", detect, translate }), translateWallContent({ text: "Original", preferredLanguage: "en", detect, translate })]);
  assert.equal(one.translatedText, "Translated");
  assert.equal(two.translatedText, "Translated");
  assert.equal(detectionCalls, 1);
  assert.equal(translationCalls, 1);
});
test("same-language content does not call the translation provider", async () => {
  const result = await translateWallContent({ text: "Hello", preferredLanguage: "en", detect: async () => "en-US", translate: () => { throw new Error("Unexpected translation"); } });
  assert.equal(result.sameLanguage, true);
  assert.equal(result.translatedText, "Hello");
});
test("edits invalidate cached content and failed detection can be retried", async () => {
  let calls = 0;
  const detect = async () => { calls++; if (calls === 1) throw new Error("temporary"); return "en-US"; };
  await assert.rejects(wallTranslationMetadata({ text: "Hello", detect }));
  await wallTranslationMetadata({ text: "Hello", detect });
  await wallTranslationMetadata({ text: "Changed", detect });
  assert.equal(calls, 3);
});


test("unknown language is not falsely reported as already translated", async () => {
  await assert.rejects(translateWallContent({ text: "Unrecognized", preferredLanguage: "en", detect: async () => "" }), { statusCode: 503, code: "LANGUAGE_DETECTION_UNAVAILABLE" });
});
