import test from "node:test";
import assert from "node:assert/strict";
import { getStarExchangeRate, setStarExchangeRate } from "./starExchangeService.js";
test("earning conversion stays fixed at 10 coins per USD", async () => {
  assert.equal(await getStarExchangeRate(), 10);
  await assert.rejects(setStarExchangeRate(1000, "admin"), { code: "INVALID_STAR_EXCHANGE_RATE" });
});
