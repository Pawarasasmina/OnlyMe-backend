import test from "node:test";
import assert from "node:assert/strict";
import BonusGrant from "../models/BonusGrant.js";
import { BONUS_EXPIRY_DAYS, bonusExpiryAt, welcomeBonusFor } from "./bonusService.js";
test("first pack welcome bonus is ten percent capped at fifty coins", () => { assert.equal(welcomeBonusFor(50), 5); assert.equal(welcomeBonusFor(300), 30); assert.equal(welcomeBonusFor(1000), 50); assert.equal(welcomeBonusFor(2500), 50); });
test("bonus grants expire independently after ninety days and welcome bonus is unique", () => { assert.equal(BONUS_EXPIRY_DAYS, 90); assert.equal(bonusExpiryAt(new Date("2026-01-01T00:00:00.000Z")).toISOString(), "2026-04-01T00:00:00.000Z"); assert.ok(BonusGrant.schema.indexes().some(([keys, options]) => keys.user === 1 && options.unique && options.partialFilterExpression?.welcomeBonusStars)); });
