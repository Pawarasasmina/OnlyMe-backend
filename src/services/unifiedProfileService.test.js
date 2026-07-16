import assert from "node:assert/strict";
import test from "node:test";
import { profileViewerCapabilities, serializeUnifiedProfile } from "./unifiedProfileService.js";

const owner = { _id: "owner-id", role: "creator", name: "Creator", username: "creator", avatar: "", isVerified: false, creatorApprovalStatus: "approved", createdAt: new Date() };
const roleProfile = { _id: "profile-id", bio: "Bio", profileVisibility: "public", verificationStatus: "pending", socialLinks: [] };

test("owner detection requires matching user IDs rather than usernames", () => {
  assert.equal(profileViewerCapabilities(owner, { _id: "other-id", username: "creator" }).isOwner, false);
  assert.equal(profileViewerCapabilities(owner, { _id: "owner-id" }).isOwner, true);
});

test("approved and pending creator capabilities are server-derived", () => {
  assert.equal(profileViewerCapabilities(owner, { _id: "owner-id" }).canCreate, true);
  assert.equal(profileViewerCapabilities({ ...owner, creatorApprovalStatus: "pending" }, { _id: "owner-id" }).canCreate, false);
});

test("public profile contract excludes private account and verification fields", () => {
  const result = serializeUnifiedProfile({ owner: { ...owner, email: "private@example.com" }, roleProfile: { ...roleProfile, documentPath: "private/file", internalNote: "secret" }, viewer: null, content: [] });
  const json = JSON.stringify(result);
  assert.equal(result.viewerCapabilities.isOwner, false);
  assert.equal(json.includes("private@example.com"), false);
  assert.equal(json.includes("private/file"), false);
  assert.equal(json.includes("secret"), false);
  assert.equal("creatorVerificationStatus" in result.profile, false);
});

test("locked published content does not expose media URLs", () => {
  const content = [{ _id: "content", creator: owner._id, title: "Locked", description: "", contentType: "IMAGE", accessLevel: "PAY_PER_VIEW", coinPrice: 10, status: "PUBLISHED", media: [{ assetId: "secret", secureUrl: "https://secret" }] }];
  const result = serializeUnifiedProfile({ owner, roleProfile, viewer: null, content });
  assert.equal(result.publicContent[0].locked, true);
  assert.equal(JSON.stringify(result.publicContent).includes("https://secret"), false);
});

test("public profile serialization does not grant admin media access", () => {
  const content = [{ _id: "content", creator: owner._id, title: "Locked", description: "", contentType: "IMAGE", accessLevel: "SUBSCRIBER_ONLY", status: "PUBLISHED", media: [{ assetId: "secret", secureUrl: "https://secret" }] }];
  const result = serializeUnifiedProfile({ owner, roleProfile, viewer: { _id: "admin", role: "admin" }, content });
  assert.equal(result.publicContent[0].locked, true);
  assert.equal(JSON.stringify(result.publicContent).includes("https://secret"), false);
});

test("profile contract separates published Seens, planets, and legacy content", () => {
  const snapshot = { metadata: { title: "Structured", summary: "", description: "", category: "", tags: [], pricing: {}, planet: {} }, chapters: [{ stableChapterId: "c", order: 0, title: "C", isPreview: true, blocks: [] }], version: 1, frozenAt: new Date() };
  const seen = { _id: "seen", creator: owner._id, kind: "SEEN", status: "PUBLISHED", publishedSnapshot: snapshot };
  const world = { _id: "world", creator: owner._id, kind: "WORLD", status: "PUBLISHED", publishedSnapshot: snapshot };
  const result = serializeUnifiedProfile({ owner, roleProfile, viewer: null, content: [], seens: [seen], planets: [world] });
  assert.equal(result.seens.length, 1); assert.equal(result.planets.length, 1); assert.equal(result.publicContent.length, 0);
});
