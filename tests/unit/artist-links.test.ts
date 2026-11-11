import { test } from "node:test";
import assert from "node:assert/strict";
import { withScheme } from "@/lib/links";

test("a bare host gets https://", () => {
  assert.equal(withScheme("tiktok.com/@noraquill"), "https://tiktok.com/@noraquill");
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
  assert.deepEqual(normalizeInstagramUrl("@nora.quill"), { url: "https://instagram.com/nora.quill" });
  assert.deepEqual(normalizeInstagramUrl(" noraquill "), { url: "https://instagram.com/noraquill" });
});

test("instagram: an instagram.com link is kept, with https added when missing", () => {
  assert.deepEqual(normalizeInstagramUrl("https://www.instagram.com/noraquill/"), { url: "https://www.instagram.com/noraquill/" });
  assert.deepEqual(normalizeInstagramUrl("instagram.com/noraquill"), { url: "https://instagram.com/noraquill" });
});

test("instagram: anything else is refused", () => {
  assert.deepEqual(normalizeInstagramUrl("https://example.com/x"), { error: INSTAGRAM_BAD });
  assert.deepEqual(normalizeInstagramUrl("@"), { error: INSTAGRAM_BAD });
});
