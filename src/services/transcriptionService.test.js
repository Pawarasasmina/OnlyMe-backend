import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../config/env.js";
import { normalizeDeepgramTranscription, transcribeVoiceNote } from "./transcriptionService.js";

test("normalizes Deepgram transcript and confidence", () => {
  const result = normalizeDeepgramTranscription({
    results: {
      channels: [{ alternatives: [{ confidence: 0.93, transcript: " Hello from Atseen. " }] }],
    },
  });

  assert.deepEqual(result, {
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
