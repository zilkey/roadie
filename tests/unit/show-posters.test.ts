// Covers the show folder naming helper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { showFolderName } from "@/server/commands/showPosters";

test("pure: the show folder is named for the date and venue, with no slashes", () => {
  assert.equal(showFolderName({ date: "2027-01-16", venue: { name: "Deep End" } }), "2027-01-16 Deep End");
  assert.equal(showFolderName({ date: "2027-01-16", venue: { name: "The 7/10 Room" } }), "2027-01-16 The 7-10 Room");
  assert.equal(showFolderName({ date: "2027-01-16", kind: "house", hostName: "Nora" }), "2027-01-16 House concert · Nora");
});
