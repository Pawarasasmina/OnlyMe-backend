import assert from "node:assert/strict";
import test from "node:test";
import { worldIncludedExperienceIds } from "./publicationEntitlementService.js";

test("World paid Seen access includes published and newly attached live IDs", () => {
  const ids = worldIncludedExperienceIds({
    includedExperienceIds: ["new-paid-seen"],
    publishedSnapshot: { metadata: { includedExperienceIds: ["published-paid-seen"] } },
  });

  assert.deepEqual([...ids], ["published-paid-seen", "new-paid-seen"]);
});

