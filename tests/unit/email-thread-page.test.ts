/** The thread page's helpers: previews, initials, paragraphs and who a reply goes to. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewOf, initialsOf, paragraphsOf, replyRecipients } from "@/lib/email-text";

test("previewOf: unquoted text on one line, cut at 110", () => {
  assert.equal(previewOf("Dec 11 works.\n\nOn Tue, Dec 2 at 9:00 AM Nora wrote:\n> Can we?"), "Dec 11 works.");
  assert.equal(previewOf("a ".repeat(100)).length <= 110, true);
  assert.equal(previewOf("x".repeat(300)).length, 110);
});

test("initialsOf: names and addresses", () => {
  assert.equal(initialsOf("Wren Reyes"), "WR");
  assert.equal(initialsOf("Rudy"), "R");
  assert.equal(initialsOf("rosa@pinehollow.example"), "R");
  assert.equal(initialsOf("pine.hollow@x.example"), "PH");
  assert.equal(initialsOf(""), "?");
});

test("paragraphsOf: blank lines split, single newlines stay", () => {
  assert.deepEqual(paragraphsOf("Hi,\r\nline two\n\n\nBye"), ["Hi,\nline two", "Bye"]);
  assert.deepEqual(paragraphsOf("  \n"), []);
});

test("replyRecipients: Reply is the last sender (or who I wrote to), Reply all is everyone but me", () => {
  const got = { from: "rosa@pinehollow.example", to: ["rudy@example.com"], direction: "received" };
  const mine = { from: "rudy@example.com", to: ["rosa@pinehollow.example"], direction: "sent" };
  const all = ["rosa@pinehollow.example", "Booking@pinehollow.example", "rudy@example.com"];
  assert.deepEqual(replyRecipients("reply", got, all, "rudy@example.com"), ["rosa@pinehollow.example"]);
  assert.deepEqual(replyRecipients("reply", mine, all, "rudy@example.com"), ["rosa@pinehollow.example"]);
  assert.deepEqual(replyRecipients("all", got, all, "rudy@example.com"), ["rosa@pinehollow.example", "booking@pinehollow.example"]);
  assert.deepEqual(replyRecipients("reply", undefined, all, "rudy@example.com"), []);
});
