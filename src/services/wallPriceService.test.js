import test from "node:test";
import assert from "node:assert/strict";
import { readWallPrice } from "./wallPriceService.js";
import { validateWallCreation } from "./wallCreationService.js";

test("optional listing prices use their location's currency and preserve Free", () => {
  assert.deepEqual(readWallPrice("1500", "Buy & Sell", "Dubai, UAE"), { price: 1500, currency: "AED" });
  assert.deepEqual(readWallPrice(0, "Buy & Sell", "London, United Kingdom"), { price: 0, currency: "GBP" });
  assert.deepEqual(readWallPrice("", "Question", "Paris"), { price: null, currency: "" });
  assert.deepEqual(readWallPrice("25", "Buy & Sell", "Paris, France"), { price: 25, currency: "EUR" });
});
test("invalid prices fail before publication reserves a daily slot", () => {
  for (const price of [-1, "NaN", Infinity, {}, true, "1000000000", "1e3"]) {
    assert.throws(() => validateWallCreation({ text: "Desk", postType: "Buy & Sell", price }, {}), { statusCode: 400 });
  }
  assert.throws(() => readWallPrice(10, "Question", "Dubai"), { statusCode: 400 });
});

test("country metadata takes precedence, unknown countries never default to AED", () => {
  assert.deepEqual(readWallPrice("1250", "Buy & Sell", "Dubai, UAE", "GB"), { price: 1250, currency: "GBP" });
  assert.deepEqual(readWallPrice(" ", "Buy & Sell", ""), { price: null, currency: "" });
  assert.deepEqual(readWallPrice("0", "Buy & Sell", "paris, fr"), { price: 0, currency: "EUR" });
  assert.throws(() => readWallPrice("25", "Buy & Sell", "Dubai, Unknown"), { statusCode: 400 });
  assert.throws(() => readWallPrice("1.5", "Buy & Sell", "Tokyo, Japan"), { statusCode: 400 });
  assert.throws(() => readWallPrice("1.125", "Buy & Sell", "Kuwait"), { statusCode: 400 });
  assert.throws(() => readWallPrice("1.125", "Buy & Sell", "UAE"), { statusCode: 400 });
});

test("fractional and formatted API prices are rejected; whole numeric values persist", () => {
 for (const value of ["12.50",12.5,"1,500","-1","1e2"]) assert.throws(() => readWallPrice(value,"Buy & Sell","UAE"), {statusCode:400});
 assert.deepEqual(readWallPrice(1500,"Buy & Sell","Tokyo, Japan"), {price:1500,currency:"JPY"});
});
