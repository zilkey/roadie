// Roadie policy: confirm rules, eligibility and summaries (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcluded, needsConfirm, summarize } from "@/server/assistant/policy";

test("confirm: status changes and Bandsintown listing on shows.update; calendar sends; shows.create never touches Calendar", () => {
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { status: "canceled" } }), true);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { publishToBandsintown: true } }), true);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { publishToBandsintown: false } }), true);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { times: { loadIn: "18:00" } } }), false);
  assert.equal(needsConfirm("shows.create", { date: "2026-11-14", venueId: "v" }), false);
  assert.equal(needsConfirm("shows.create", { date: "2026-11-14", venueId: "v", sendInvites: true }), false);
  assert.equal(needsConfirm("shows.calendar", { id: "x", on: true }), true);
  assert.equal(needsConfirm("rehearsals.calendar", { id: "x", on: true }), true);
  assert.equal(needsConfirm("shows.calendarPreview", { id: "x" }), false);
  assert.equal(needsConfirm("musicians.archive", { id: "m" }), true);
  assert.equal(needsConfirm("musicians.removeFromBand", { id: "m" }), true);
  assert.equal(needsConfirm("artists.removeSongField", { id: "a", fieldId: "f" }), true);
  assert.equal(needsConfirm("artists.removeShowField", { id: "a", fieldId: "f" }), true);
  assert.equal(needsConfirm("artists.addSongField", { id: "a", label: "Capo" }), false);
  assert.equal(needsConfirm("people.list", {}), false);
});

test("eligibility: band settings are open except creating a band; users.addToBand is the one users.* exception", () => {
  assert.equal(isExcluded("artists.create"), true);
  assert.equal(isExcluded("artists.update"), false);
  assert.equal(isExcluded("artists.addSongField"), false);
  assert.equal(isExcluded("users.addToBand"), false);
  assert.equal(isExcluded("users.add"), true);
  assert.equal(isExcluded("users.update"), true);
  assert.equal(isExcluded("shows.setChecklists"), true);
  assert.equal(isExcluded("google.disconnect"), true);
  assert.equal(isExcluded("google.connectUrl"), true);
});

test("summaries: cancel, Bandsintown, calendar send, archive, remove field", () => {
  assert.equal(summarize("shows.update", { id: "x", patch: { status: "canceled", reason: "rain" } }, "Deep End · 2026-11-14"), "Change the show Deep End · 2026-11-14 to canceled (rain)");
  assert.equal(summarize("shows.update", { id: "x", patch: { publishToBandsintown: true } }, "Deep End"), "List Deep End on Bandsintown");
  assert.equal(summarize("shows.update", { id: "x", patch: { publishToBandsintown: false } }, "Deep End"), "Take Deep End off Bandsintown");
  assert.equal(summarize("shows.calendar", { id: "x", on: true }, "Deep End"), "Put the show Deep End on the band calendar and invite the band");
  assert.equal(summarize("shows.calendar", { id: "x", on: false }, "Deep End"), "Take the show Deep End off the band calendar");
  assert.equal(summarize("musicians.archive", { id: "m" }, "Mae"), "Archive Mae: they leave the band and lose their sign-in for this band");
  assert.equal(summarize("musicians.removeFromBand", { id: "m" }, "Mae"), "Take Mae out of the band (they keep their sign-in)");
  assert.equal(summarize("artists.removeSongField", { id: "a", fieldId: "f" }), "Delete the song field: every song loses its value");
});

test("money summaries read like the sentence the person said", () => {
  const felix = { person: "Felix", project: "Band" };
  assert.equal(summarize("expenses.add", { userId: "u", amount: 4200, what: "gas", category: "travel", payBack: true }, undefined, felix), "We owe Felix $42.00 for gas (pay back, Band)");
  assert.equal(summarize("expenses.add", { amount: 75000, what: "video shoot", category: "video", projectId: "p" }, undefined, { project: "Lighthouse video" }), "Put $750.00 video shoot on Lighthouse video");
  assert.equal(summarize("payouts.add", { to: { userId: "u" }, kind: "pay", amount: 10000, paidAt: "2026-10-29", method: "venmo" }, undefined, { person: "Felix", show: "Pine Hollow" }), "We paid Felix $100.00 for the Pine Hollow show (Venmo)");
  assert.equal(summarize("payouts.add", { to: { name: "Wren" }, kind: "pay", amount: 20000, what: "the tour" }, undefined, { person: "Wren" }), "We owe Wren $200.00 for the tour");
  assert.equal(summarize("payouts.markPaid", { id: "p", method: "cash" }, undefined, { person: "Felix", amount: 10000 }), "We paid Felix $100.00 (Cash)");
  assert.equal(summarize("income.add", { from: "Pine Hollow", amount: 40000, category: "guarantee" }), "Pine Hollow owes us $400.00 (guarantee, owed)");
  assert.equal(summarize("income.add", { from: "Pine Hollow", amount: 40000, category: "guarantee", receivedAt: "2026-10-29", method: "check" }, undefined, { project: "Band" }), "Pine Hollow paid us $400.00 (guarantee, Check, Band)");
  assert.equal(summarize("income.setReceived", { id: "i", method: "venmo" }, undefined, { from: "Pine Hollow", amount: 40000 }), "Mark Pine Hollow income of $400.00 as received (Venmo)");
  assert.equal(summarize("projects.create", { kind: "video", name: "Lighthouse video" }), "Start the video project Lighthouse video");
  assert.equal(summarize("projects.close", { id: "p" }, undefined, { name: "Lighthouse video" }), "Close the project Lighthouse video: nothing new can be put on it");
  assert.equal(summarize("expenses.payPerson", { userId: "u", method: "venmo" }, undefined, { person: "Felix", total: 4200 }), "Pay Felix $42.00 (Venmo)");
  for (const c of ["income.add", "income.update", "income.setReceived", "income.remove", "payouts.add", "payouts.update", "payouts.markPaid", "payouts.remove", "projects.create", "projects.update", "projects.close", "projects.reopen", "projects.remove", "expenses.payPerson"]) assert.ok(needsConfirm(c, {}), c);
  assert.equal(needsConfirm("expenses.add", { amount: 4200, what: "gas", category: "travel", userId: "u", payBack: true }), false);
});
