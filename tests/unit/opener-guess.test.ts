import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { guessModel, guessOpenerSlots, roomFacts, showFacts, type GuessShow } from "../../src/server/events/openerGuess";
import { keepSlot } from "../../src/server/events/refresh";

const TODAY = "2026-11-20";
const NOW = new Date("2026-11-20T12:00:00Z");
const show = (id: string, o: Partial<GuessShow> = {}): GuessShow => ({ id, date: "2027-01-08", title: "Touring Band", acts: [{ name: "Touring Band", role: "headliner" }], bill: "full", status: "onsale", ...o });
const pub = { name: "Coopersmith's", type: "Bar", city: "Fort Collins", stats: { supportShare: 0.05, billsSeen: 20 } };

/** A stand-in for the Anthropic client: answers with the given yes/no per id, and records what it was sent. */
function fakeClient(answer: (ids: string[]) => { id: string; open: boolean; why: string }[]) {
  const sent: { prompt: string; model: string }[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (req: { model: string; messages: { content: string }[] }) => {
          sent.push({ prompt: req.messages[0].content, model: req.model });
          const ids = [...req.messages[0].content.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
          return { content: [{ type: "text", text: JSON.stringify({ shows: answer(ids) }) }] };
        },
      },
    } as never,
  };
}

describe("the import's opener-slot guess", () => {
  test("plain cases never reach the model: support listed, cancelled, past", async () => {
    const f = fakeClient(() => { throw new Error("asked"); });
    const got = await guessOpenerSlots([
      show("sup", { acts: [{ name: "A", role: "headliner" }, { name: "B", role: "support" }] }),
      show("can", { status: "cancelled" }),
      show("past", { date: "2026-11-01" }),
    ], pub, TODAY, { now: NOW, model: "claude-x", client: f.client });
    assert.equal(f.sent.length, 0);
    assert.deepEqual([...got.values()].map((s) => [s.open, s.why]), [[false, "Support already listed"], [false, "Cancelled"], [false, "Already happened"]]);
  });

  test("the model's yes/no and reason are stored as the guess; a show it skipped gets the rules'", async () => {
    const f = fakeClient((ids) => ids.filter((i) => i !== "skip").map((id) => ({ id, open: id === "yes", why: id === "yes" ? "Touring headliner, room adds openers" : "Weeknight at a pub" })));
    const got = await guessOpenerSlots([show("yes"), show("wed", { date: "2027-01-06" }), show("skip", { supportTba: true })], pub, TODAY, { now: NOW, model: "claude-x", client: f.client });
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].model, "claude-x");
    assert.deepEqual(got.get("yes"), { open: true, why: "Touring headliner, room adds openers", by: "guess", at: NOW.toISOString() });
    assert.deepEqual(got.get("wed"), { open: false, why: "Weeknight at a pub", by: "guess", at: NOW.toISOString() });
    // skipped: the rules say likely (support still to be announced)
    assert.equal(got.get("skip")?.open, true);
  });

  test("the model gets the worked-out facts: weekday, days out, the room's type and record, the rules' read", async () => {
    const f = fakeClient((ids) => ids.map((id) => ({ id, open: false, why: "x" })));
    await guessOpenerSlots([show("wed", { date: "2027-01-06" })], pub, TODAY, { now: NOW, model: "claude-x", client: f.client });
    const p = f.sent[0].prompt;
    assert.match(p, /"weekday": "Wednesday"/);
    assert.match(p, /"daysOut": 47/);
    assert.match(p, /"type": "Bar"/);
    assert.match(p, /rarely \(5% of 20 past bills had support\)/);
    assert.match(p, /"read": "(likely|maybe|unlikely)"/);
    assert.equal(showFacts(show("a", { tourStops: 3 }), pub, TODAY).coloradoRoomsOnThisRun, 3);
    assert.equal(roomFacts({ name: "New room" }).booksOpeners, "not enough past bills to say");
  });

  test("a failed call falls back to the rules; no model (fake mode, no key) is the rules", async () => {
    const broken = { messages: { create: async () => { throw new Error("529 overloaded"); } } } as never;
    const a = await guessOpenerSlots([show("tba", { supportTba: true }), show("one", { bill: "headliner", date: "2026-11-25" })], pub, TODAY, { now: NOW, model: "claude-x", client: broken });
    assert.equal(a.get("tba")?.open, true);
    assert.equal(a.get("one")?.open, false);
    const b = await guessOpenerSlots([show("tba", { supportTba: true })], pub, TODAY, { now: NOW, model: null });
    assert.equal(b.get("tba")?.open, true);
    assert.equal(guessModel({ ROADIE_MODEL: "fake", ANTHROPIC_API_KEY: "k" } as never), undefined);
    assert.equal(guessModel({ ROADIE_MODEL: "vertex" } as never), undefined);
    assert.equal(guessModel({ ROADIE_MODEL: "vertex", ANTHROPIC_API_KEY: "k" } as never), "claude-sonnet-5-5");
  });
});

describe("an opener slot across refreshes", () => {
  const at = "2026-11-01T00:00:00Z";
  const headliner = { acts: [{ name: "A", role: "headliner" as const }] };
  const withSupport = { acts: [{ name: "A", role: "headliner" as const }, { name: "B", role: "support" as const }] };
  test("a person's choice stays, even when support turns up", () => {
    const mine = { open: true, by: "person" as const, at };
    assert.equal(keepSlot(mine, withSupport, "now"), mine);
    const off = { open: false, by: "person" as const, at };
    assert.equal(keepSlot(off, headliner, "now"), off);
  });
  test("a guess that said open turns off once support is listed; otherwise it stays", () => {
    const g = { open: true, by: "guess" as const, why: "Support TBA", at };
    assert.equal(keepSlot(g, headliner, "now"), g);
    assert.deepEqual(keepSlot(g, withSupport, "now"), { open: false, by: "guess", why: "Support now listed", at: "now" });
    assert.equal(keepSlot(undefined, headliner, "now"), undefined);
  });
});
