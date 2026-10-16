import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../config/env.js";
import { normalizeDeepgramTranscription, transcribeVoiceNote, prepareWallVoiceTranscript } from "./transcriptionService.js";

test("normalizes Deepgram transcript and confidence", () => {
  const result = normalizeDeepgramTranscription({
    results: {
      channels: [{ alternatives: [{ confidence: 0.93, transcript: " Hello from Atseen. " }] }],
    },
  });

  assert.deepEqual(result, {
    detectedLanguage: "",
    confidence: 0.93,
    emptySpeech: false,
    transcript: "Hello from Atseen.",
  });
});

test("normalizes silent Deepgram response as empty speech", () => {
  const result = normalizeDeepgramTranscription({
    results: {
      channels: [{ alternatives: [{ confidence: 0, transcript: "" }] }],
    },
  });

  assert.equal(result.emptySpeech, true);
  assert.equal(result.transcript, "");
});

test("transcription rejects missing audio before provider call", async () => {
  await assert.rejects(
    () => transcribeVoiceNote(),
    (error) => error.code === "AUDIO_REQUIRED" && error.statusCode === 400
  );
});

test("transcription uses provided Deepgram client", async () => {
  const client = {
    listen: {
      v1: {
        media: {
          transcribeFile: async (uploadable, options) => {
            assert.equal(uploadable.contentType, "audio/webm");
            assert.equal(uploadable.filename, "test.webm");
            assert.equal(options.model, env.deepgramTranscriptionModel);
            assert.equal(options.smart_format, true);
            assert.equal(options.detect_language, true);
            return {
              results: {
                channels: [{ alternatives: [{ confidence: 0.81, transcript: "Real transcript" }] }],
              },
            };
          },
        },
      },
    },
  };

  const result = await transcribeVoiceNote({
    buffer: Buffer.from("audio"),
    client,
    filename: "test.webm",
    mimeType: "audio/webm",
  });

  assert.equal(result.provider, "deepgram");
  assert.equal(result.transcript, "Real transcript");
  assert.equal(result.confidence, 0.81);
});

test("provider failures return a sanitized transcription error", async () => {
  const client = {
    listen: {
      v1: {
        media: {
          transcribeFile: async () => {
            throw new Error("secret provider detail");
          },
        },
      },
    },
  };

  await assert.rejects(
    () => transcribeVoiceNote({ buffer: Buffer.from("audio"), client }),
    (error) => error.code === "TRANSCRIPTION_FAILED" && error.message === "Could not transcribe the voice note."
  );
});


test("voice transcription includes the provider-detected original language", () => {
  const result = normalizeDeepgramTranscription({ results: { channels: [{ detected_language: "es", alternatives: [{ transcript: "Hola", confidence: 0.9 }] }] } });
  assert.equal(result.detectedLanguage, "es");
});


test("existing transcripts do not cause a second transcription request", async () => {
  const result = await prepareWallVoiceTranscript({ file: { path: "audio.webm" }, transcript: "Already transcribed", transcriptLanguage: "en", client: {}, readAudio: () => { throw new Error("Unexpected read"); } });
  assert.equal(result.transcript, "Already transcribed");
  assert.equal(result.transcriptLanguage, "en-US");
});

test("voice-only uploads get automatic transcripts without blocking audio on provider failures", async () => {
  const client = { listen: { v1: { media: { transcribeFile: async () => ({ results: { channels: [{ detected_language: "fr", alternatives: [{ transcript: "Bonjour" }] }] } }) } } } };
  const result = await prepareWallVoiceTranscript({ file: { path: "audio.webm" }, client, readAudio: async () => Buffer.from("audio") });
  assert.equal(result.transcript, "Bonjour");
  assert.equal(result.transcriptLanguage, "fr-FR");
  const fallback = await prepareWallVoiceTranscript({ file: { path: "audio.webm" }, client, readAudio: async () => { throw new Error("Unavailable"); } });
  assert.equal(fallback.transcript, "");
});
