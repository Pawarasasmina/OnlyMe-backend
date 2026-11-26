import assert from "node:assert/strict";
import test from "node:test";
import { telegramButtonUrl } from "./alertSettingsService.js";

test("Telegram buttons require a provider-compatible public URL", () => {
  assert.equal(telegramButtonUrl("http://localhost:5173/admin/user-reports/1"), "");
  assert.equal(telegramButtonUrl("http://127.0.0.1:5173/admin/user-reports/1"), "");
  assert.equal(telegramButtonUrl("not a URL"), "");
  assert.equal(telegramButtonUrl("https://admin.example.com/admin/user-reports/1"), "https://admin.example.com/admin/user-reports/1");
});
