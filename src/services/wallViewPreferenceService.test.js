import test from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import { getWallView, setWallView } from "./wallViewPreferenceService.js";

test("view defaults to feed and saves only the requested account's validated preference", async t => {
  const users = new Map([["one", {}], ["two", {}]]);
  const query = user => ({ select: () => ({ lean: async () => user }) });
  t.mock.method(User, "findById", id => query(users.get(id)));
  t.mock.method(User, "findByIdAndUpdate", (id, update) => {
    Object.assign(users.get(id), update.$set); return query(users.get(id));
  });
  assert.equal(await getWallView("one"), "feed");
  await setWallView("one", "grid");
  assert.equal(await getWallView("one"), "grid");
  assert.equal(await getWallView("two"), "feed");
  await assert.rejects(setWallView("one", "invalid"), { statusCode: 400 });
  assert.ok(User.schema.path("wallViewPreference"));
});
