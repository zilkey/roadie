import { test } from "node:test";
import assert from "node:assert/strict";
import { pngText } from "@/server/assistant/readImage";
import { pngWithText } from "../fixtures/png-text";

test("pngText: finds the ocr text chunk in a PNG, in UTF-8", () => {
  assert.equal(pngText(pngWithText("Fri Dec 5 · The Grand · $15")), "Fri Dec 5 · The Grand · $15");
  assert.equal(pngText(pngWithText("line one\nline two")), "line one\nline two");
});

test("pngText: another keyword, no chunk, or not a PNG is undefined", () => {
  assert.equal(pngText(pngWithText("hi", "Comment")), undefined);
  assert.equal(pngText(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), undefined);
  assert.equal(pngText(new Uint8Array(0)), undefined);
  assert.equal(pngText(pngWithText("x").subarray(0, 20)), undefined, "a cut-off file doesn't throw");
});
