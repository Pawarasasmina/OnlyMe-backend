import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ProfileRelationship from "../models/ProfileRelationship.js";
import { profileRelationshipServiceTestUtils } from "./profileRelationshipService.js";

const { followedCreatorAggregation, serializeFollowedCreator } = profileRelationshipServiceTestUtils;

test("follow relationships have a unique actor target type index", () => {
  const indexes = ProfileRelationship.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => (
    fields.actor === 1
    && fields.target === 1
    && fields.type === 1
    && options?.unique === true
  )));
});

test("saved people aggregation reads active public approved creator follows only", () => {
  const userId = new mongoose.Types.ObjectId();
  const blockedId = new mongoose.Types.ObjectId();
  const pipeline = followedCreatorAggregation({ blockedIds: [blockedId], userId });

  assert.deepEqual(pipeline[0].$match, {
    actor: userId,
    type: "FOLLOW",
    target: { $nin: [userId, blockedId] },
  });
  assert.deepEqual(pipeline[3].$match, {
    "targetUser.role": { $in: ["fan", "creator"] },
    "targetUser.status": "active",
    "targetUser.creatorApprovalStatus": "approved",
  });
  assert.deepEqual(pipeline[6].$match, { "creatorProfile.profileVisibility": "public" });
});

test("followed creator serializer exposes public fields and no private account fields", () => {
  const userId = new mongoose.Types.ObjectId();
  const serialized = serializeFollowedCreator({
    followerCount: 12,
    relationship: { _id: new mongoose.Types.ObjectId(), createdAt: new Date("2026-01-02T00:00:00.000Z") },
    user: {
      _id: userId,
      name: "Lina Ray",
      username: "lina",
      avatar: "https://example.com/lina.jpg",
      email: "private@example.com",
      password: "secret",
      resetPasswordToken: "token",
      isVerified: true,
      role: "creator",
      activeStatus: { isActive: true, label: "At seen", emoji: "", color: "#9CCBFF" },
    },
    profile: {
      bio: "Creator bio",
      category: "Travel",
      city: "Madrid",
      country: "Spain",
      phoneNumber: "+100000000",
    },
  });

  assert.equal(serialized.id, String(userId));
  assert.equal(serialized.displayName, "Lina Ray");
  assert.equal(serialized.username, "lina");
  assert.equal(serialized.category, "Travel");
  assert.equal(serialized.location, "Madrid, Spain");
  assert.equal(serialized.isFollowing, true);
  assert.equal(serialized.followersCount, 12);
  assert.equal(serialized.email, undefined);
  assert.equal(serialized.password, undefined);
  assert.equal(serialized.resetPasswordToken, undefined);
  assert.equal(serialized.phoneNumber, undefined);
});

test("followed creator serializer respects hidden public location", () => {
  const serialized = serializeFollowedCreator({
    user: { _id: new mongoose.Types.ObjectId(), username: "anna", role: "creator" },
    profile: {
      city: "Paris",
      country: "France",
      privacySettings: { showLocation: false },
    },
  });

  assert.equal(serialized.location, "");
});
