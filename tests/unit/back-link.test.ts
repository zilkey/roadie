import { test } from "node:test";
import assert from "node:assert/strict";
import { canGoBackInApp } from "@/lib/backLink";

const origin = "https://roadie.example";
test("Back goes back only when the previous history entry is in this app", () => {
  assert.equal(canGoBackInApp(origin, { entries: [`${origin}/rehearsals`, `${origin}/rehearsals/1`], index: 1 }, 2), true);
  assert.equal(canGoBackInApp(origin, { entries: [`${origin}/rehearsals/1`], index: 0 }, 1), false, "a shared link in a fresh tab");
  assert.equal(canGoBackInApp(origin, { entries: ["https://mail.example/inbox", `${origin}/rehearsals/1`], index: 1 }, 2), false, "arrived from another site");
  assert.equal(canGoBackInApp(origin, null, 1), false);
  assert.equal(canGoBackInApp(origin, null, 3), true, "no Navigation API: any earlier history");
});
