import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../config/env.js";
import {
  clearTranslationLanguageCache,
  listSupportedTranslationLanguages,
  normalizeLaraTranslateResponse,
  translateVoiceTranscript,
} from "./translationService.js";

const originalEnv = {
  laraAccessKeyId: env.laraAccessKeyId,
  laraAccessKeySecret: env.laraAccessKeySecret,
  laraTranslationTimeoutMs: env.laraTranslationTimeoutMs,
};

test.beforeEach(() => {
  clearTranslationLanguageCache();
  env.laraAccessKeyId = "test-access-key-id";
  env.laraAccessKeySecret = "test-access-key-secret";
  env.laraTranslationTimeoutMs = 15000;
});

test.after(() => {
  env.laraAccessKeyId = originalEnv.laraAccessKeyId;
  env.laraAccessKeySecret = originalEnv.laraAccessKeySecret;
  env.laraTranslationTimeoutMs = originalEnv.laraTranslationTimeoutMs;
});

test("normalizes Lara languages from SDK locale codes", async () => {
  const languages = await listSupportedTranslationLanguages({
    translator: {
      getLanguages: async () => ["fr-FR", "en-US", "fr-FR", "si-LK"],
    },
  });

  assert.deepEqual(languages, [
    { code: "en-US", name: "English" },
    { code: "fr-FR", name: "French" },
    { code: "si-LK", name: "Sinhala" },
  ]);
});

test("static Lara languages are available without credentials for the selector", async () => {
  env.laraAccessKeyId = "";
  env.laraAccessKeySecret = "";

  const languages = await listSupportedTranslationLanguages();
  assert.ok(languages.some((language) => language.code === "fr-FR" && language.name === "French"));
  assert.ok(languages.some((language) => language.code === "ta-IN" && language.name === "Tamil"));
});

test("normalizes Lara translation response", () => {
  const result = normalizeLaraTranslateResponse({ sourceLanguage: "en-US", translation: " Bonjour " });

  assert.deepEqual(result, {
    detectedLanguage: "en-US",
    provider: "lara",
    translatedText: "Bonjour",
  });
});

test("translation rejects missing text before provider translate call", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", translator: { translate: async () => ({}) } }),
    (error) => error.code === "TEXT_REQUIRED" && error.statusCode === 400
  );
});

test("translation rejects empty text", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", text: "  \n  ", translator: { translate: async () => ({}) } }),
    (error) => error.code === "TEXT_REQUIRED" && error.statusCode === 400
  );
});

test("translation rejects missing target language", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ text: "Hello", translator: { translate: async () => ({}) } }),
    (error) => error.code === "TARGET_LANGUAGE_REQUIRED" && error.statusCode === 400
  );
});

test("translation rejects too-long transcript", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", text: "a".repeat(2001), translator: { translate: async () => ({}) } }),
    (error) => error.code === "TEXT_TOO_LONG" && error.statusCode === 400
  );
});

test("translation rejects unsupported target language", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "xx-ZZ", text: "Hello", translator: { translate: async () => ({}) } }),
    (error) => error.code === "UNSUPPORTED_LANGUAGE" && error.statusCode === 400
  );
});

test("translation rejects unsupported source language", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ sourceLanguage: "xx-ZZ", targetLanguage: "fr-FR", text: "Hello", translator: { translate: async () => ({}) } }),
    (error) => error.code === "UNSUPPORTED_LANGUAGE" && error.statusCode === 400
  );
});

test("translation requires Lara credentials when no mock translator is supplied", async () => {
  env.laraAccessKeyId = "";
  env.laraAccessKeySecret = "";

  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", text: "Hello" }),
    (error) => error.code === "TRANSLATION_NOT_CONFIGURED" && error.statusCode === 503
  );
});

test("translation calls Lara with automatic source detection", async () => {
  const calls = [];
  const translator = {
    translate: async (text, source, target, options) => {
      calls.push({ options, source, target, text });
      return { sourceLanguage: "en-US", translation: "Bonjour" };
    },
  };

  const result = await translateVoiceTranscript({
    targetLanguage: "fr-FR",
    text: "Hello",
    translator,
  });

  assert.equal(calls[0].text, "Hello");
  assert.equal(calls[0].source, null);
  assert.equal(calls[0].target, "fr-FR");
  assert.equal(calls[0].options.timeoutInMillis, 15000);
  assert.equal(result.provider, "lara");
  assert.equal(result.detectedLanguage, "en-US");
  assert.equal(result.translatedText, "Bonjour");
});

test("translation maps short source and target language codes to Lara locales", async () => {
  const translator = {
    translate: async (_text, source, target) => {
      assert.equal(source, "en-US");
      assert.equal(target, "fr-FR");
      return { sourceLanguage: "en-US", translation: "Bonjour" };
    },
  };

  const result = await translateVoiceTranscript({
    sourceLanguage: "en",
    targetLanguage: "fr",
    text: "Hello",
    translator,
  });

  assert.equal(result.detectedLanguage, "en-US");
  assert.equal(result.translatedText, "Bonjour");
});

test("same explicit source and target skips provider translate call", async () => {
  let translateCalled = false;
  const result = await translateVoiceTranscript({
    sourceLanguage: "en",
    targetLanguage: "en-US",
    text: "Hello",
    translator: {
      translate: async () => {
        translateCalled = true;
        return {};
      },
    },
  });

  assert.equal(translateCalled, false);
  assert.equal(result.sameLanguage, true);
  assert.equal(result.provider, "lara");
  assert.equal(result.translatedText, "Hello");
});

test("provider authentication failures are sanitized", async () => {
  const translator = {
    translate: async () => {
      throw Object.assign(new Error("secret provider detail"), { statusCode: 401, type: "AuthenticationError" });
    },
  };

  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", text: "Hello", translator }),
    (error) => error.code === "TRANSLATION_FAILED" && error.statusCode === 502
  );
});

test("provider quota failures are sanitized", async () => {
  const translator = {
    translate: async () => {
      throw Object.assign(new Error("quota detail"), { statusCode: 429, type: "QuotaExceeded" });
    },
  };

  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", text: "Hello", translator }),
    (error) => error.code === "TRANSLATION_FAILED" && error.statusCode === 429
  );
});

test("provider timeout returns controlled error", async () => {
  const translator = {
    translate: async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    },
  };

  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", text: "Hello", translator }),
    (error) => error.code === "TRANSLATION_TIMEOUT" && error.statusCode === 504
  );
});

test("malformed provider translation response is sanitized", async () => {
  const translator = {
    translate: async () => ({}),
  };

  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr-FR", text: "Hello", translator }),
    (error) => error.code === "TRANSLATION_FAILED" && error.statusCode === 502
  );
});
