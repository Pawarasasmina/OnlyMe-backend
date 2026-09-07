import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { normalizeEntityRefsInput } from "./contentEntityService.js";

test("content entity refs normalize supported type/id pairs", () => {
  const id = new mongoose.Types.ObjectId();
  const refs = normalizeEntityRefsInput([
    { entityId: id, entityType: "place" },
    { id, type: "place" },
  ]);

  assert.equal(refs.length, 1);
  assert.equal(refs[0].entityType, "place");
  assert.equal(String(refs[0].entityId), String(id));
});

test("content entity refs reject unsupported types and invalid IDs", () => {
  assert.throws(() => normalizeEntityRefsInput([{ entityId: new mongoose.Types.ObjectId(), entityType: "city" }]), /Unsupported attached entity type/);
  assert.throws(() => normalizeEntityRefsInput([{ entityId: "Miracle Garden", entityType: "place" }]), /Attached entity ID must be valid/);
});

test("content entity refs accept JSON form payloads", () => {
  const id = new mongoose.Types.ObjectId();
  const refs = normalizeEntityRefsInput(JSON.stringify([{ targetId: id, type: "book" }]));

  assert.deepEqual(refs.map((ref) => ({ entityId: String(ref.entityId), entityType: ref.entityType })), [
    { entityId: String(id), entityType: "book" },
  ]);
});
