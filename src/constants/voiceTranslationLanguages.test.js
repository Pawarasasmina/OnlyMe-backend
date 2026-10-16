import test from "node:test";
import assert from "node:assert/strict";
import { resolveSupportedVoiceLanguage } from "./voiceTranslationLanguages.js";
import { detectTextLanguage } from "../services/translationService.js";

test("provider base codes resolve to supported locales", async () => {
  for (const [base, locale] of [["ja", "ja-JP"], ["ta", "ta-IN"], ["si", "si-LK"], ["ar", "ar-SA"], ["en", "en-US"]]) {
    assert.equal(resolveSupportedVoiceLanguage(base)?.code, locale);
    assert.equal(await detectTextLanguage("sample", { translator: { detect: async () => ({ language: base }) } }), locale);
  }
  assert.equal(resolveSupportedVoiceLanguage("invalid"), null);
});
