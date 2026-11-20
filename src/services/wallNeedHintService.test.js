import test from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import { getWallHintDismissals, dismissWallHint } from "./wallNeedHintService.js";

test("Wall hints are read and atomically dismissed only for the authenticated account", async t => {
  const accounts = new Map([["one", []], ["two", []]]);
  const query = result => ({ select: () => ({ lean: async () => result }) });
  t.mock.method(User, "findById", id => query({ wallHintDismissals: accounts.get(id) }));
  t.mock.method(User, "findByIdAndUpdate", (id, update, options) => {
    assert.deepEqual(options, { new: true });
    assert.deepEqual(Object.keys(update), ["$addToSet"]);
    accounts.set(id, [...new Set([...accounts.get(id), update.$addToSet.wallHintDismissals])]);
    return query({ wallHintDismissals: accounts.get(id) });
  });
  assert.deepEqual(await getWallHintDismissals("one"), []);
  await dismissWallHint("one", "need_help");
  await dismissWallHint("one", "need_help");
  assert.deepEqual(await getWallHintDismissals("one"), ["need_help"]);
  assert.deepEqual(accounts.get("one"), ["need_help"]);
  accounts.set("one", ["need_help", "tip:wk:rec"]);
  assert.deepEqual(await getWallHintDismissals("one"), ["need_help", "recommendation"]);
  assert.deepEqual(await getWallHintDismissals("two"), []);
  await assert.rejects(dismissWallHint("one", "__proto__"), { statusCode: 400 });
  assert.ok(User.schema.path("wallHintDismissals"));
});
