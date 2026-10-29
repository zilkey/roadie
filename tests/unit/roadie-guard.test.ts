import { test } from "node:test";
import assert from "node:assert/strict";
import type { MessageData } from "genkit";
import { claimsChange, cleanMessages, withoutThoughts, requestShape } from "@/server/assistant/guard";
import { script, NUDGE, ASK_MISSING } from "@/server/assistant/script";

test("claimsChange: promises, done-claims and 'it's there' are claims", () => {
  for (const t of ["My bad, let me update that right now.", "I've updated the load-in.", "Added Dean Landi to the show.",
    "St. Vrain Cidery's set is on the page, and the contact is there.", "On it.", "Done."]) {
    assert.equal(claimsChange(t), true, t);
  }
});

test("claimsChange: questions and plain facts are not", () => {
  for (const t of ["What time is load-in?", "Set times are 6:30 PM.", "The setlist runs 79 minutes.", "Load-in is at 5:00 PM.", "", "   \n "]) {
    assert.equal(claimsChange(t), false, JSON.stringify(t));
  }
});

test("cleanMessages drops the system message Genkit folds into the previous step's messages (the prompt is passed separately each call)", () => {
  const out = cleanMessages([{ role: "system", content: [{ text: "You are Roadie." }] }, { role: "user", content: [{ text: "hi" }] }, { role: "model", content: [{ text: "hello" }] }]);
  assert.deepEqual(out.map((m) => m.role), ["user", "model"]);
});

test("cleanMessages drops empty text and empty thoughts, and messages left empty; keeps calls, results and signed thoughts", () => {
  const messages: MessageData[] = [
    { role: "user", content: [{ text: "hi" }, { text: "  " }] },
    { role: "model", content: [{ text: "" }, { reasoning: "" }] },
    { role: "model", content: [{ reasoning: "", metadata: { thoughtSignature: "sig" } }, { reasoning: "" }] },
    { role: "model", content: [{ toolRequest: { name: "shows.update", input: {} } }] },
    { role: "tool", content: [{ toolResponse: { name: "shows.update", output: {} } }] },
  ];
  const out = cleanMessages(messages);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0].content, [{ text: "hi" }]);
  assert.deepEqual(out[1].content, [{ reasoning: "", metadata: { thoughtSignature: "sig" } }]);
  assert.ok(out[2].content[0].toolRequest);
  assert.ok(out[3].content[0].toolResponse);
});

test("withoutThoughts drops reasoning but keeps a tool call's thought signature", () => {
  const out = withoutThoughts([
    { role: "model", content: [{ reasoning: "thinking", metadata: { thoughtSignature: "s1" } }, { toolRequest: { name: "shows.update", input: {} }, metadata: { thoughtSignature: "s2" } }] },
    { role: "model", content: [{ reasoning: "only a thought" }] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].content.length, 1);
  assert.equal(out[0].content[0].reasoning, undefined);
  assert.equal(out[0].content[0].metadata?.thoughtSignature, "s2");
});

test("requestShape describes parts without any of the message's words", () => {
  const shape = requestShape([
    { role: "user", content: [{ text: "secret" }] },
    { role: "model", content: [{ toolRequest: { name: "shows.update", input: { note: "private" } }, metadata: { thoughtSignature: "x" } }] },
    { role: "tool", content: [{ toolResponse: { name: "shows.update", output: { ok: "private" } } }] },
  ]);
  assert.equal(shape, "user[text:6] model[call:shows.update+sig] tool[result:shows.update]");
  assert.doesNotMatch(shape, /secret|private/);
});

test("script answers the nudge by asking for the missing value", () => {
  assert.equal(script({ text: NUDGE }).text, ASK_MISSING);
});
