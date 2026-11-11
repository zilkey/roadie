// Posts: Meta token encryption (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sealMeta, unsealMeta } from "@/server/meta/connection";

process.env.META_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

test("encryption round-trips, with a fresh IV each time", () => {
  const a = sealMeta("IGAAlong-123"), b = sealMeta("IGAAlong-123");
  assert.notEqual(a, b);
  assert.equal(unsealMeta(a), "IGAAlong-123");
  assert.throws(() => unsealMeta(a.replace(/.$/, (c) => (c === "A" ? "B" : "A"))));
});
