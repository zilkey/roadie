// Covers the scripted fake model, model-mode selection and the route registry (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelMode } from "@/server/assistant/ai";
import { script, OFF_TOPIC, CANT_DO, BAD_FINDER, CALENDAR_OPTIONS } from "@/server/assistant/script";
import { resolveRoute, routeForPath } from "@/lib/routes";

test("model defaults to the canned one under emulators", () => {
  assert.equal(modelMode({ FIRESTORE_EMULATOR_HOST: "x" } as never), "fake");
  assert.equal(modelMode({} as never), "vertex");
  assert.equal(modelMode({ GEMINI_API_KEY: "k" } as never), "gemini");
  assert.equal(modelMode({ ROADIE_MODEL: "vertex", GEMINI_API_KEY: "k" } as never), "vertex");
  assert.equal(modelMode({ ROADIE_MODEL: "fake" } as never), "fake");
});

test("script: greeting, off-topic, can't-do, navigation", () => {
  assert.match(script({ text: "hi" }).text!, /Roadie/);
  assert.equal(script({ text: "what's the weather" }).text, OFF_TOPIC);
  assert.equal(script({ text: "delete the Top Hat show" }).text, CANT_DO);
  assert.deepEqual(script({ text: "show me the shows" }).calls, [{ name: "ui.navigate", input: { route: "shows" } }]);
  assert.deepEqual(script({ text: "go to money" }).calls, [{ name: "ui.navigate", input: { route: "money" } }]);
});

test("script: show questions use shows.list with the filter, and answer from its rows", () => {
  assert.deepEqual(script({ text: "how many shows were canceled?" }).calls, [{ name: "shows.list", input: { filter: "canceled" } }]);
  assert.deepEqual(script({ text: "Which gigs got dropped" }).calls, [{ name: "shows.list", input: { filter: "dropped" } }]);
  assert.deepEqual(script({ text: "what shows are coming up" }).calls, [{ name: "shows.list", input: { filter: "upcoming" } }]);
  assert.deepEqual(script({ text: "cancel the Deep End show" }).calls, [{ name: "search", input: { q: "deep end", kinds: ["show"] } }]);
  const out = (shows: { name: string; date: string }[]) => ({ untrustedContent: { filter: "canceled", count: shows.length, shows } });
  const steps = (o: unknown) => [{ name: "shows.list", input: { filter: "canceled" }, output: o }];
  assert.equal(script({ text: "how many shows were canceled?", steps: steps(out([{ name: "Deep End", date: "2026-09-01" }])) }).text, "1 show canceled: Deep End · 2026-09-01.");
  assert.equal(script({ text: "how many shows were canceled?", steps: steps(out([])) }).text, "No shows canceled.");
});

test("script: \"X canceled, <reason>\" cancels and \"we're dropping X, <reason>\" drops, with the reason as typed; \"why\" reads it back", () => {
  const hit = (id: string, name: string) => [{ name: "search", input: {}, output: { untrustedContent: { results: [{ kind: "show", id, name }] } } }];
  const cancel = "Oskar Blues canceled, they double-booked the patio.";
  assert.deepEqual(script({ text: cancel }).calls, [{ name: "search", input: { q: "oskar blues", kinds: ["show"] } }]);
  assert.deepEqual(script({ text: cancel, steps: hit("s1", "Oskar Blues") }).calls, [{ name: "shows.cancel", input: { id: "s1", reason: "they double-booked the patio" } }]);
  const drop = "We're dropping the Drifters show, the money's not there.";
  assert.deepEqual(script({ text: drop }).calls, [{ name: "search", input: { q: "drifters", kinds: ["show"] } }]);
  assert.deepEqual(script({ text: drop, steps: hit("s2", "Drifters Thrift Bar") }).calls, [{ name: "shows.drop", input: { id: "s2", reason: "the money's not there" } }]);
  assert.deepEqual(script({ text: "Oskar Blues canceled", steps: hit("s1", "Oskar Blues") }).calls, [{ name: "shows.cancel", input: { id: "s1" } }]);
  const why = "Why did we cancel Gold Hill?";
  assert.deepEqual(script({ text: why }).calls, [{ name: "search", input: { q: "gold hill", kinds: ["show"] } }]);
  assert.deepEqual(script({ text: why, steps: hit("s3", "Gold Hill Inn") }).calls, [{ name: "records.get", input: { kind: "shows", id: "s3" } }]);
  const got = (o: unknown) => [...hit("s3", "Gold Hill Inn"), { name: "records.get", input: {}, output: { untrustedContent: o } }];
  assert.equal(script({ text: why, steps: got({ id: "s3", status: "canceled", reason: "Venue double-booked the room." }) }).text, "It was canceled: Venue double-booked the room.");
  assert.equal(script({ text: why, steps: got({ id: "s3", status: "canceled" }) }).text, "It was canceled, but nobody wrote down why.");
});

test("script: a calendar ask it can't place asks back, with options", () => {
  for (const text of ["put a deadline in the calendar for Dec 5", "remind me to text Josh"]) {
    assert.deepEqual(script({ text }).calls, [{ name: "ui.ask", input: { question: `${BAD_FINDER} Did you want:`, options: CALENDAR_OPTIONS } }]);
  }
});

test("routes: registry resolves names, never raw URLs", () => {
  assert.equal(resolveRoute("show", { id: "abc" })?.href, "/shows/abc");
  assert.equal(resolveRoute("show", { id: "../x" }), null);
  assert.equal(resolveRoute("/shows"), null);
  assert.deepEqual(routeForPath("/shows/abc"), { route: "show", params: { id: "abc" } });
  assert.equal(routeForPath("/nope"), null);
});
