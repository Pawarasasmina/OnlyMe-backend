import assert from "node:assert/strict";
import test from "node:test";
import Publication from "./Publication.js";
import Chapter from "./Chapter.js";
import PublicationSeries from "./PublicationSeries.js";
test("publication defines concurrency and query indexes", () => { const indexes = Publication.schema.indexes(); assert.equal(indexes.some(([keys, options]) => keys.creator === 1 && keys["planet.slot"] === 1 && options.unique), true); assert.equal(indexes.some(([keys, options]) => keys.creator === 1 && keys.kind === 1 && options.unique), true); });
test("chapters have unique order and stable ID per publication", () => { const indexes = Chapter.schema.indexes(); assert.equal(indexes.filter(([, options]) => options.unique).length, 2); });
test("Seen visibility, share links, and Series ownership are indexed", () => { const publicationIndexes = Publication.schema.indexes(); const seriesIndexes = PublicationSeries.schema.indexes(); assert.equal(publicationIndexes.some(([keys]) => keys.kind === 1 && keys.status === 1 && keys.visibility === 1 && keys.publishedAt === -1), true); assert.equal(publicationIndexes.some(([keys, options]) => keys.shareToken === 1 && options.unique && options.sparse), true); assert.equal(seriesIndexes.some(([keys, options]) => keys.creator === 1 && keys.normalizedName === 1 && options.unique), true); });
