// splitQuoted/snippetOf, agoText and the fake Gmail's search syntax (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { matches } from "../../fakes/fake-gmail/query";
import { splitQuoted, snippetOf, agoText } from "@/lib/email-text";

test("splitQuoted: everything from 'On … wrote:' or the first '>' line is the quote", () => {
  assert.deepEqual(splitQuoted("Dec 11 works.\n\nOn Tue, Dec 2, 2026 at 9:00 AM Nora <i@x.com> wrote:\n> Can we do Dec 11?\n> Thanks"), { text: "Dec 11 works.", quoted: "On Tue, Dec 2, 2026 at 9:00 AM Nora <i@x.com> wrote:\n> Can we do Dec 11?\n> Thanks" });
  assert.deepEqual(splitQuoted("Yes\n> earlier\nmore"), { text: "Yes", quoted: "> earlier\nmore" });
  assert.deepEqual(splitQuoted("  Just this.  \r\n"), { text: "Just this.", quoted: "" });
  assert.deepEqual(splitQuoted("On the other hand\nwe could wrote: no"), { text: "On the other hand\nwe could wrote: no", quoted: "" });
  assert.deepEqual(splitQuoted("> all quoted"), { text: "", quoted: "> all quoted" });
  assert.equal(snippetOf("a ".repeat(200) + "\n> q").length <= 160, true);
  assert.equal(snippetOf("Line one\n\n  line   two"), "Line one line two");
});

test("agoText says how long ago, in plain words", () => {
  const now = Date.UTC(2026, 9, 27, 12);
  assert.equal(agoText(now - 20_000, now), "just now");
  assert.equal(agoText(now - 60_000, now), "1 minute ago");
  assert.equal(agoText(now - 12 * 60_000, now), "12 minutes ago");
  assert.equal(agoText(now - 3 * 3600_000, now), "3 hours ago");
  assert.equal(agoText(now - 50 * 3600_000, now), "2 days ago");
});

test("the fake's search syntax: words, from:, to:, OR, parentheses, quotes; a plain q is one substring", () => {
  const m = { from: "rosa@pinehollow.example", to: ["rudy@example.com"], cc: ["cc@x.example"], subject: "Support slot", body: "Dec 11 works for us" };
  const hit = (q: string) => matches(q, m);
  assert.equal(hit(""), true);
  assert.equal(hit("Support slot"), true, "plain substring");
  assert.equal(hit("slot support"), false);
  assert.equal(hit("from:rosa@pinehollow.example"), true);
  assert.equal(hit("from:@pinehollow.example"), true);
  assert.equal(hit("from:rudy@example.com"), false);
  assert.equal(hit("to:rudy@example.com"), true);
  assert.equal(hit("to:cc@x.example"), true);
  assert.equal(hit("from:(nobody@x.example OR rosa@pinehollow.example)"), true);
  assert.equal(hit("from:(nobody@x.example OR other@x.example)"), false);
  assert.equal(hit("from:(a@x OR b@x) OR to:(rudy@example.com)"), true);
  assert.equal(hit("from:(a@x OR b@x) OR \"Pine Hollow\""), false);
  assert.equal(hit("from:rosa@pinehollow.example OR \"nothing here\""), true);
  assert.equal(hit("(slot OR zebra) dec"), true);
  assert.equal(hit("(zebra OR yak) dec"), false);
  assert.equal(hit('"works for us" from:rosa@pinehollow.example'), true);
  assert.equal(hit('"works for them" OR zebra'), false);
});
