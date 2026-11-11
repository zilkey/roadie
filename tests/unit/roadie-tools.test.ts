// Roadie tools: the tool list, confirm rules and schema normalising (registry only, no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { EXCLUDED, needsConfirm } from "@/server/assistant/policy";
import { toolDefs } from "@/server/assistant/tools";
import { MAX_REPLY_CHARS, MAX_STEPS } from "@/server/assistant/flow";

test("tool list comes from the registry and leaves out what Roadie must not do", () => {
  const names = toolDefs("admin").map((t) => t.name);
  for (const must of ["expenses.add", "expenses.estimateGas", "geo.autocomplete", "me.updateDriving", "rehearsals.setLocation", "rehearsals.importSetlist", "shows.update", "shows.cancel", "shows.setStatus", "records.get", "context.now", "search", "history.undoRun", "ui.navigate"]) assert.ok(names.includes(must), must);
  for (const bad of ["users.add", "users.update", "users.remove", "mcpTokens.create", "mcpTokens.revoke", "artists.create", "assistant.setPrefs", "drafts.save", "drafts.list", "history.myRuns", "pitches.checkReplies"]) {
    assert.equal(names.includes(bad), false, bad);
    assert.ok(EXCLUDED.some((e) => bad === e || (e.endsWith(".") && bad.startsWith(e))), `${bad} is in the explicit list`);
  }
  // every admin command that is not excluded is a tool
  const expected = Object.values(registry).filter((c) => c.roles.includes("admin") && !EXCLUDED.some((e) => c.name === e || (e.endsWith(".") && c.name.startsWith(e)))).map((c) => c.name);
  for (const e of expected) assert.ok(names.includes(e), e);
  for (const t of toolDefs("admin")) { assert.equal(t.inputJsonSchema.type, "object", t.name); assert.ok(t.description.length > 3); }
  const add = toolDefs("admin").find((t) => t.name === "expenses.add")!;
  assert.ok((add.inputJsonSchema.properties as Record<string, unknown>).amount);
  assert.deepEqual(toolDefs("member"), []);
  assert.equal(MAX_STEPS, 12);
  assert.ok(MAX_REPLY_CHARS > 500 && MAX_REPLY_CHARS < 3000);
});

test("confirm rules: sends, money, deletes, cancels and more than 5 records", () => {
  for (const c of ["pitches.sendEmail", "availability.ask", "availability.remind", "expenses.setPaidBack", "expenses.payPerson", "income.add", "income.update", "income.setReceived", "income.remove", "payouts.add", "payouts.update", "payouts.markPaid", "payouts.remove", "projects.create", "projects.update", "projects.close", "projects.reopen", "projects.remove", "shows.cancel", "shows.setStatus", "shows.drop", "shows.remove", "venues.remove", "pitches.remove"]) assert.ok(needsConfirm(c, {}), c);
  assert.equal(needsConfirm("expenses.add", { amount: 5000, what: "gas", category: "travel" }), false);
  // a shared venue edit reaches every band: it asks. The band's own notes and links do not. Merging always asks.
  assert.equal(needsConfirm("venues.update", { id: "v", patch: { capacity: 300 } }), true);
  assert.equal(needsConfirm("venues.update", { id: "v", patch: { notes: "x", capacity: null } }), true);
  assert.equal(needsConfirm("venues.update", { id: "v", patch: { notes: "x", loadInNotes: "y", contactIds: ["c"] } }), false);
  assert.equal(needsConfirm("venues.mergeInto", { from: "a", into: "b" }), true);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { personnel: ["a", "b", "c"] } }), false);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { personnel: ["a", "b", "c", "d", "e", "f"] } }), true);
  assert.equal(needsConfirm("shows.setChecklists", { id: "x", checklists: [{ name: "Gear", items: Array.from({ length: 9 }, (_, i) => ({ label: String(i) })) }] }), false);
  assert.equal(needsConfirm("availability.check", { dates: Array.from({ length: 9 }, () => "2026-01-01") }), false);
});

test("the money commands are tools, showDeals.setIncome is gone, and every schema normalises for Gemini", () => {
  const defs = toolDefs("admin");
  const names = defs.map((t) => t.name);
  for (const must of ["projects.create", "projects.update", "projects.close", "projects.reopen", "projects.remove", "income.add", "income.update", "income.remove", "income.setReceived", "payouts.add", "payouts.update", "payouts.remove", "payouts.markPaid", "expenses.payPerson"]) assert.ok(names.includes(must), must);
  assert.equal(names.includes("showDeals.setIncome"), false);
  for (const n of names.filter((x) => /^(projects|income|payouts)\./.test(x))) {
    const t = defs.find((d) => d.name === n)!;
    assert.equal(t.inputJsonSchema.type, "object", n);
    assert.ok(!JSON.stringify(t.inputJsonSchema).includes('"$ref"'), `${n} has no $ref`);
    assert.ok(!JSON.stringify(t.inputJsonSchema).includes('"const"'), `${n} has no const`);
    // Gemini takes string (and, in practice, number) enum values only: a boolean literal becomes enum [true] and Vertex refuses the whole tool list.
    const walk = (s: unknown, path: string) => {
      if (!s || typeof s !== "object") return;
      const e = (s as { enum?: unknown[] }).enum;
      if (Array.isArray(e)) for (const v of e) assert.ok(typeof v === "string" || typeof v === "number", `${n}${path}.enum holds ${JSON.stringify(v)}`);
      for (const [k, v] of Object.entries(s)) if (typeof v === "object") walk(v, `${path}.${k}`);
    };
    walk(t.inputJsonSchema, "");
  }
  const pay = defs.find((t) => t.name === "payouts.add")!;
  assert.ok((pay.inputJsonSchema.properties as Record<string, unknown>).to);
  assert.ok((defs.find((t) => t.name === "expenses.add")!.inputJsonSchema.properties as Record<string, unknown>).projectId);
});
