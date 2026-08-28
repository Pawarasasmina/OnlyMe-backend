import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../config/env.js";
import {
  clearTranslationLanguageCache,
  listSupportedTranslationLanguages,
  normalizeLibreTranslateResponse,
  translateVoiceTranscript,
} from "./translationService.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test.beforeEach(() => {
  clearTranslationLanguageCache();
  env.libreTranslateUrl = "http://127.0.0.1:5000";
  env.libreTranslateApiKey = "";
  env.libreTranslateTimeoutMs = 15000;
});

test("normalizes LibreTranslate languages", async () => {
  const languages = await listSupportedTranslationLanguages({
    fetchImpl: async (url) => {
      assert.equal(url, "http://127.0.0.1:5000/languages");
      return jsonResponse([
        { code: "fr", name: "French" },
        { code: "en", name: "English" },
        { code: "fr", name: "French" },
      ]);
    },
  });

  assert.deepEqual(languages, [
    { code: "en", name: "English" },
    { code: "fr", name: "French" },
  ]);
});

test("normalizes LibreTranslate translation response", () => {
  const result = normalizeLibreTranslateResponse({ translatedText: " Bonjour " }, "auto");

  assert.deepEqual(result, {
    detectedLanguage: "",
    provider: "libretranslate",
    translatedText: "Bonjour",
  });
});

test("translation rejects missing text before provider translate call", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr" }),
    (error) => error.code === "TEXT_REQUIRED" && error.statusCode === 400
  );
});

test("translation rejects missing target language", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ text: "Hello" }),
    (error) => error.code === "TARGET_LANGUAGE_REQUIRED" && error.statusCode === 400
  );
});

test("translation rejects too-long transcript", async () => {
  await assert.rejects(
    () => translateVoiceTranscript({ targetLanguage: "fr", text: "a".repeat(2001) }),
    (error) => error.code === "TEXT_TOO_LONG" && error.statusCode === 400
  );
});

test("translation rejects unsupported language from running provider", async () => {
  const fetchImpl = async () => jsonResponse([{ code: "en", name: "English" }]);

  await assert.rejects(
    () => translateVoiceTranscript({ fetchImpl, targetLanguage: "fr", text: "Hello" }),
    (error) => error.code === "UNSUPPORTED_LANGUAGE" && error.statusCode === 400
  );
});

test("translation calls LibreTranslate with source auto", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ body: options.body ? JSON.parse(options.body) : null, method: options.method, url });
    if (url.endsWith("/languages")) return jsonResponse([{ code: "en", name: "English" }, { code: "fr", name: "French" }]);
    assert.equal(url, "http://127.0.0.1:5000/translate");
    return jsonResponse({ detectedLanguage: { language: "en" }, translatedText: "Bonjour" });
  };

  const result = await translateVoiceTranscript({
    fetchImpl,
    targetLanguage: "fr",
    text: "Hello",
  });

  assert.deepEqual(calls[1].body, {
    format: "text",
    q: "Hello",
    source: "auto",
    target: "fr",
  });
  assert.equal(result.provider, "libretranslate");
  assert.equal(result.detectedLanguage, "en");
  assert.equal(result.translatedText, "Bonjour");
});

test("translation passes explicit source language", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/languages")) return jsonResponse([{ code: "en", name: "English" }, { code: "fr", name: "French" }]);
    assert.equal(JSON.parse(options.body).source, "en");
    return jsonResponse({ translatedText: "Bonjour" });
  };

  const result = await translateVoiceTranscript({
    fetchImpl,
    sourceLanguage: "en",
    targetLanguage: "fr",
    text: "Hello",
  });

  assert.equal(result.detectedLanguage, "en");
  assert.equal(result.translatedText, "Bonjour");
});

test("translation includes optional API key only when configured", async () => {
  env.libreTranslateApiKey = "test-key";
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/languages")) return jsonResponse([{ code: "en", name: "English" }, { code: "fr", name: "French" }]);
    assert.equal(JSON.parse(options.body).api_key, "test-key");
    return jsonResponse({ translatedText: "Bonjour" });
  };

  await translateVoiceTranscript({ fetchImpl, targetLanguage: "fr", text: "Hello" });
});

test("same explicit source and target skips provider translate call", async () => {
  let translateCalled = false;
  const fetchImpl = async (url) => {
    if (url.endsWith("/translate")) translateCalled = true;
    return jsonResponse([{ code: "en", name: "English" }]);
  };

  const result = await translateVoiceTranscript({
    fetchImpl,
    sourceLanguage: "en",
    targetLanguage: "en",
    text: "Hello",
  });

  assert.equal(translateCalled, false);
  assert.equal(result.sameLanguage, true);
  assert.equal(result.translatedText, "Hello");
});

test("provider unavailable returns controlled error", async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error("connect ECONNREFUSED"), { cause: { code: "ECONNREFUSED" } });
  };

  await assert.rejects(
    () => listSupportedTranslationLanguages({ fetchImpl }),
    (error) => error.code === "TRANSLATION_SERVICE_UNAVAILABLE" && error.statusCode === 503
  );
});

test("provider timeout returns controlled error", async () => {
  env.libreTranslateTimeoutMs = 1;
  const fetchImpl = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });

  await assert.rejects(
    () => listSupportedTranslationLanguages({ fetchImpl }),
    (error) => error.code === "TRANSLATION_TIMEOUT" && error.statusCode === 504
  );
});

test("provider HTTP errors are sanitized", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/languages")) return jsonResponse([{ code: "en", name: "English" }, { code: "fr", name: "French" }]);
    return jsonResponse({ error: "secret provider detail" }, 500);
  };

  await assert.rejects(
    () => translateVoiceTranscript({ fetchImpl, targetLanguage: "fr", text: "Hello" }),
    (error) => error.code === "TRANSLATION_SERVICE_UNAVAILABLE" && error.statusCode === 502
  );
});

test("malformed provider translation response is sanitized", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/languages")) return jsonResponse([{ code: "en", name: "English" }, { code: "fr", name: "French" }]);
    return jsonResponse({});
  };

  await assert.rejects(
    () => translateVoiceTranscript({ fetchImpl, targetLanguage: "fr", text: "Hello" }),
    (error) => error.code === "TRANSLATION_FAILED" && error.statusCode === 502
  );
});
