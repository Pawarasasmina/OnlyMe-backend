import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../app.js";
import User from "../models/User.js";
import FeedPost from "../models/FeedPost.js";
import Notification from "../models/Notification.js";
import { getFanActivity } from "./fanController.js";

test("Saves filter finds an older saved note behind 100 newer events and All paginates to it", async () => {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri());
    const owner = new mongoose.Types.ObjectId();
    const saver = new mongoose.Types.ObjectId();
    await User.collection.insertMany([
      { _id: owner, name: "Note author", username: "note-author", role: "fan", status: "active" },
      { _id: saver, name: "Saver", username: "note-saver", role: "fan", status: "active" },
    ]);
    const old = new Date(Date.now() - 10 * 86400000);
    const post = await FeedPost.create({ author: owner, text: "Book a table before you go.", status: "published", saves: [{ user: saver, createdAt: old, updatedAt: old }] });
    await Notification.collection.insertMany(Array.from({ length: 100 }, (_, i) => ({ user: owner, type: "system", title: `Newer activity ${i}`, createdAt: new Date(Date.now() - i * 1000) })));
    const read = async (filter, page = "1") => {
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await getFanActivity({ user: { _id: owner }, query: { direction: "received", filter, limit: "30", page } }, res, error => { throw error; });
      assert.equal(res.code, 200);
      return res.body.data;
    };
    const saves = await read("saves");
    assert.equal(saves.items.length, 1);
    assert.equal(saves.items[0].aggregate.count, 1);
    assert.equal(saves.items[0].title, "1 person saved your note");
    assert.equal(saves.items[0].actionPath, `/posts/${post._id}`);
    assert.equal(saves.items[0].target.preview, post.text);
    const first = await read("all");
    assert.equal(first.items.length, 30);
    assert.equal(first.pageInfo.hasMore, true);
    const later = await read("all", "4");
    assert.equal(later.items.some(item => item.type === "wall_save_group"), true);
    assert.equal(later.items.length, 101);
    await FeedPost.updateOne({ _id: post._id }, { $set: { saves: [], saveCount: 0 } });
    assert.equal((await read("saves")).items.length, 0);
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
});
