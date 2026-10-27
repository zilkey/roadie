import { test } from "node:test";
import assert from "node:assert/strict";
import { withScheme } from "@/lib/links";

test("a bare host gets https://", () => {
  assert.equal(withScheme("tiktok.com/@ingridavison"), "https://tiktok.com/@ingridavison");
});

test("http and https URLs are unchanged", () => {
  assert.equal(withScheme("http://example.com/a"), "http://example.com/a");
  assert.equal(withScheme("https://example.com/a"), "https://example.com/a");
});

test("callers trim first; withScheme itself keeps what it's given", () => {
  assert.equal(withScheme("  tiktok.com/x  ".trim()), "https://tiktok.com/x");
});

import { normalizeInstagramUrl, INSTAGRAM_BAD } from "@/schema";

test("instagram: an @handle or bare handle becomes the full URL", () => {
  assert.deepEqual(normalizeInstagramUrl("@ingrid.avison"), { url: "https://instagram.com/ingrid.avison" });
  assert.deepEqual(normalizeInstagramUrl(" ingridavison "), { url: "https://instagram.com/ingridavison" });
});

test("instagram: an instagram.com link is kept, with https added when missing", () => {
  assert.deepEqual(normalizeInstagramUrl("https://www.instagram.com/ingridavison/"), { url: "https://www.instagram.com/ingridavison/" });
  assert.deepEqual(normalizeInstagramUrl("instagram.com/ingridavison"), { url: "https://instagram.com/ingridavison" });
});

test("instagram: anything else is refused", () => {
  assert.deepEqual(normalizeInstagramUrl("https://example.com/x"), { error: INSTAGRAM_BAD });
  assert.deepEqual(normalizeInstagramUrl("@"), { error: INSTAGRAM_BAD });
});
