/** The thread page's helpers: previews, initials, paragraphs and who a reply goes to. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewOf, initialsOf, paragraphsOf, replyRecipients } from "@/lib/email-text";

test("previewOf: unquoted text on one line, cut at 110", () => {
  assert.equal(previewOf("Dec 11 works.\n\nOn Tue, Dec 2 at 9:00 AM Ingrid wrote:\n> Can we?"), "Dec 11 works.");
  assert.equal(previewOf("a ".repeat(100)).length <= 110, true);
  assert.equal(previewOf("x".repeat(300)).length, 110);
});

test("initialsOf: names and addresses", () => {
  assert.equal(initialsOf("Dana Reyes"), "DR");
  assert.equal(initialsOf("Jeff"), "J");
  assert.equal(initialsOf("haylee@lostlake.example"), "H");
  assert.equal(initialsOf("lost.lake@x.example"), "LL");
  assert.equal(initialsOf(""), "?");
});

test("paragraphsOf: blank lines split, single newlines stay", () => {
  assert.deepEqual(paragraphsOf("Hi,\r\nline two\n\n\nBye"), ["Hi,\nline two", "Bye"]);
  assert.deepEqual(paragraphsOf("  \n"), []);
});

test("replyRecipients: Reply is the last sender (or who I wrote to), Reply all is everyone but me", () => {
  const got = { from: "haylee@lostlake.example", to: ["jeff@example.com"], direction: "received" };
  const mine = { from: "jeff@example.com", to: ["haylee@lostlake.example"], direction: "sent" };
  const all = ["haylee@lostlake.example", "Booking@lostlake.example", "jeff@example.com"];
  assert.deepEqual(replyRecipients("reply", got, all, "jeff@example.com"), ["haylee@lostlake.example"]);
  assert.deepEqual(replyRecipients("reply", mine, all, "jeff@example.com"), ["haylee@lostlake.example"]);
  assert.deepEqual(replyRecipients("all", got, all, "jeff@example.com"), ["haylee@lostlake.example", "booking@lostlake.example"]);
  assert.deepEqual(replyRecipients("reply", undefined, all, "jeff@example.com"), []);
});
