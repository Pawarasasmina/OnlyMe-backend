import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE_MEDIA_IMAGE_MIME_TYPES,
  PROFILE_MEDIA_MAX_IMAGE_SIZE_BYTES,
  PROFILE_MEDIA_MAX_VIDEO_DURATION_SECONDS,
  PROFILE_MEDIA_MAX_VIDEO_SIZE_BYTES,
  PROFILE_MEDIA_VIDEO_MIME_TYPES,
} from "../constants/profileMediaConstants.js";
import ProfileMedia from "../models/ProfileMedia.js";
import MessageReport from "../models/MessageReport.js";
import ApiError from "../utils/ApiError.js";
import { seenMediaCandidatesFromPublication, serializeProfileMedia } from "./profileMediaService.js";
import { profileMediaTypeForFile, validateProfileMediaFile } from "./profileMediaStorageService.js";

const imageFile = {
  mimetype: "image/jpeg",
  originalname: "photo.jpg",
  size: 1024,
};

const videoFile = {
  mimetype: "video/mp4",
  originalname: "clip.mp4",
  size: 1024,
};

test("Profile Media model is permanent and independent from Story expiry semantics", () => {
  assert.equal(ProfileMedia.schema.path("expiresAt"), undefined);
  assert.equal(ProfileMedia.schema.path("duration").options.max, undefined);
  assert.deepEqual(ProfileMedia.schema.path("sourceType").enumValues, ["direct", "story", "seen"]);
  assert.equal(ProfileMedia.schema.path("sourceType").defaultValue, "direct");
  assert.ok(ProfileMedia.schema.path("sourceMediaId"));
  assert.ok(ProfileMedia.schema.path("likedBy"));
  assert.ok(ProfileMedia.schema.indexes().some(([fields]) => fields.user === 1 && fields.sortOrder === -1 && fields.createdAt === -1));
  assert.ok(ProfileMedia.schema.indexes().some(([fields, options]) => fields.user === 1 && fields.sourceType === 1 && fields.sourceId === 1 && fields.sourceMediaId === 1 && options.unique));
});

test("Profile Media reports are supported by the shared report model", () => {
  assert.ok(MessageReport.schema.path("profileMedia"));
  assert.ok(MessageReport.schema.path("scope").enumValues.includes("PROFILE_MEDIA"));
  assert.ok(MessageReport.schema.indexes().some(([fields, options]) => fields.reporter === 1 && fields.profileMedia === 1 && options.unique));
});

test("Profile Media supports the intended image and video MIME types", () => {
  assert.deepEqual(PROFILE_MEDIA_IMAGE_MIME_TYPES, ["image/jpeg", "image/png", "image/webp"]);
  assert.deepEqual(PROFILE_MEDIA_VIDEO_MIME_TYPES, ["video/mp4", "video/webm", "video/quicktime"]);
  assert.equal(profileMediaTypeForFile(imageFile), "image");
  assert.equal(profileMediaTypeForFile(videoFile), "video");
});

test("authenticated owner add flow validation accepts photo Media files", () => {
  assert.deepEqual(validateProfileMediaFile(imageFile), { mimeType: "image/jpeg", type: "image" });
});

test("authenticated owner add flow validation accepts short-video Media file containers", () => {
  assert.deepEqual(validateProfileMediaFile(videoFile), { mimeType: "video/mp4", type: "video" });
});

test("invalid Profile Media file types are rejected", () => {
  assert.throws(() => validateProfileMediaFile({ mimetype: "application/pdf", originalname: "file.pdf", size: 100 }), ApiError);
});

test("invalid Profile Media file extensions are rejected", () => {
  assert.throws(() => validateProfileMediaFile({ mimetype: "image/jpeg", originalname: "file.exe", size: 100 }), /extension/);
});

test("oversized photo Media files are rejected", () => {
  assert.throws(() => validateProfileMediaFile({ ...imageFile, size: PROFILE_MEDIA_MAX_IMAGE_SIZE_BYTES + 1 }), /8 MB/);
});

test("oversized video Media files are rejected", () => {
  assert.throws(() => validateProfileMediaFile({ ...videoFile, size: PROFILE_MEDIA_MAX_VIDEO_SIZE_BYTES + 1 }), /80 MB/);
});

test("video duration limit is a named Profile Media rule", () => {
  assert.equal(PROFILE_MEDIA_MAX_VIDEO_DURATION_SECONDS, 60);
});

test("Profile Media serialization hides storage internals and supports visitor fetch payloads", () => {
  const createdAt = new Date();
  const serialized = serializeProfileMedia({
    _id: "507f191e810c19729de860ea",
    assetId: "onlyme/profile-media/u/private",
    caption: "Beach",
    createdAt,
    duration: 12,
    height: 720,
    mimeType: "video/mp4",
    resourceType: "video",
    size: 1234,
    sourceType: "direct",
    thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    type: "video",
    updatedAt: createdAt,
    url: "https://cdn.example.com/video.mp4",
    width: 1280,
  });
  assert.equal(serialized.id, "507f191e810c19729de860ea");
  assert.equal(serialized.mediaType, "video");
  assert.equal(serialized.mediaUrl, "https://cdn.example.com/video.mp4");
  assert.equal(serialized.thumbnailUrl, "https://cdn.example.com/thumb.jpg");
  assert.equal("assetId" in serialized, false);
  assert.equal("resourceType" in serialized, false);
  assert.equal(serialized.likeCount, 0);
  assert.equal(serialized.viewerLiked, false);
});

test("missing thumbnail falls back to the media URL", () => {
  const serialized = serializeProfileMedia({ _id: "507f191e810c19729de860eb", type: "image", url: "https://cdn.example.com/photo.jpg" });
  assert.equal(serialized.thumbnailUrl, "https://cdn.example.com/photo.jpg");
});

test("owner Profile Media serialization can include source identifiers for already-added state", () => {
  const serialized = serializeProfileMedia({
    _id: "507f191e810c19729de860ec",
    sourceId: "507f191e810c19729de860ed",
    sourceMediaId: "cover",
    sourceType: "seen",
    type: "image",
    url: "https://cdn.example.com/photo.jpg",
  }, { includeSourceIds: true });
  assert.equal(serialized.sourceId, "507f191e810c19729de860ed");
  assert.equal(serialized.sourceMediaId, "cover");
  assert.equal(serialized.sourceType, "seen");
});

test("public Profile Media serialization hides source object identifiers", () => {
  const serialized = serializeProfileMedia({
    _id: "507f191e810c19729de860ee",
    sourceId: "507f191e810c19729de860ef",
    sourceMediaId: "media",
    sourceType: "story",
    type: "image",
    url: "https://cdn.example.com/photo.jpg",
  });
  assert.equal("sourceId" in serialized, false);
  assert.equal("sourceMediaId" in serialized, false);
  assert.equal(serialized.sourceType, "story");
});

test("Profile Media serialization includes like count and viewer liked state", () => {
  const viewerId = "507f191e810c19729de860f1";
  const serialized = serializeProfileMedia({
    _id: "507f191e810c19729de860f2",
    likedBy: [viewerId, "507f191e810c19729de860f3"],
    type: "image",
    url: "https://cdn.example.com/photo.jpg",
  }, { viewerId });
  assert.equal(serialized.likeCount, 2);
  assert.equal(serialized.viewerLiked, true);
});

test("Seen media candidates include cover, images, and videos while excluding unsupported blocks", () => {
  const image = { assetId: "seen/photo", mediaType: "IMAGE", resourceType: "image", secureUrl: "https://cdn.example.com/photo.jpg" };
  const video = { assetId: "seen/video", mediaType: "VIDEO", resourceType: "video", secureUrl: "https://cdn.example.com/video.mp4", duration: 12 };
  const audio = { assetId: "seen/audio", mediaType: "AUDIO", resourceType: "video", secureUrl: "https://cdn.example.com/audio.mp3" };
  const candidates = seenMediaCandidatesFromPublication(
    { _id: "507f191e810c19729de860f0", coverMedia: image },
    [{ title: "Chapter", blocks: [{ id: "same-cover", type: "IMAGE", media: image }, { id: "clip", type: "VIDEO", media: video }, { id: "voice", type: "VOICE", media: audio }, { id: "text", type: "TEXT", text: "Nope" }] }],
  );
  assert.deepEqual(candidates.map((item) => item.sourceMediaId), ["cover", "clip"]);
});
