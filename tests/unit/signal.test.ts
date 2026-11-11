import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGNAL_NO_KEY, SIGNAL_NOT_GROUP, normalizeSignalGroupUrl, signalAppUrl } from "../../src/schema/artists";
import { shareSheetFor } from "../../src/lib/signal";

const KEY = "CjQKIabc_def-123";
const CANON = `https://signal.group/#${KEY}`;

test("a Signal group link is stored as https://signal.group/#<key> however it was pasted", () => {
  for (const pasted of [CANON, `http://signal.group/#${KEY}`, `signal.group/#${KEY}`, `sgnl://signal.group/#${KEY}`,
    `  ${CANON}  `, `https://signal.group/# ${KEY}\n`, `HTTPS://Signal.Group/#${KEY}`]) {
    assert.deepEqual(normalizeSignalGroupUrl(pasted), { url: CANON }, pasted);
  }
});

test("a link with no key after the #, or that isn't a signal.group link, is refused with a clear message", () => {
  for (const bad of ["https://signal.group/#", "sgnl://signal.group/#", "signal.group/# "]) assert.deepEqual(normalizeSignalGroupUrl(bad), { error: SIGNAL_NO_KEY }, bad);
  for (const bad of ["https://example.com/chat", "https://signal.group/", `https://evil.example/signal.group/#${KEY}`, KEY]) assert.deepEqual(normalizeSignalGroupUrl(bad), { error: SIGNAL_NOT_GROUP }, bad);
});

test("Signal Desktop's link comes from the stored one", () => {
  assert.equal(signalAppUrl(CANON), `sgnl://signal.group/#${KEY}`);
});

test("only touch screens get the share sheet: a Mac with navigator.share opens Signal Desktop instead", () => {
  assert.equal(shareSheetFor({ canShare: true, coarsePointer: true }), true, "phone or iPad");
  assert.equal(shareSheetFor({ canShare: true, coarsePointer: false }), false, "Mac Safari or Chrome");
  assert.equal(shareSheetFor({ canShare: false, coarsePointer: false }), false, "desktop without share");
  assert.equal(shareSheetFor({ canShare: false, coarsePointer: true }), false, "touch screen without share");
});
