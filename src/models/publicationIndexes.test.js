import assert from "node:assert/strict";
import test from "node:test";
import Publication from "./Publication.js";
import Chapter from "./Chapter.js";
test("publication defines concurrency and query indexes", () => { const indexes = Publication.schema.indexes(); assert.equal(indexes.some(([keys, options]) => keys.creator === 1 && keys["planet.slot"] === 1 && options.unique), true); assert.equal(indexes.some(([keys, options]) => keys.creator === 1 && keys.kind === 1 && options.unique), true); });
test("chapters have unique order and stable ID per publication", () => { const indexes = Chapter.schema.indexes(); assert.equal(indexes.filter(([, options]) => options.unique).length, 2); });
