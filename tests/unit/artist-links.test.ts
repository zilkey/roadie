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
