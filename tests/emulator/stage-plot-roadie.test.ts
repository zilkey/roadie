import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { sessionFor, type Who } from "@/server/assistant/confirm";
import { execTool, toolDefs, readback } from "@/server/assistant/tools";
import { script, PLOT_NOT_SENT, CANT_DO, unwrap } from "@/server/assistant/script";
import { ensureThread, newThreadId } from "@/server/assistant/threads";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

// Stage plots through Roadie and MCP. The ten phrases from junk.stories/32-stage-plots.md (P8) are fixtures here: each one is the
// tool-call sequence a good model makes for it, run through Roadie's own execTool (so the ask-first policy applies) and checked
// against the records. The canned model (script.ts) handles the phrases it can; the others need a real model, so the calls are fixed here.
// People are the band's real five (src/lib/band.ts: Nora, Rudy keys, Hugo bass, Iris lead guitar, Felix drums).

beforeEach(resetEmulators);
const noop = () => {};
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let who: Who;
let sys: Ctx;
const ids: Record<string, string> = {};

async function setup() {
  const admin = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  who = { uid: admin.uid, role: "admin", name: "Rudy" };
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  for (const [key, name, instruments] of [["nora", "Nora", ["vocals", "guitar"]], ["rudy", "Rudy", ["keys"]], ["hugo", "Hugo", ["bass"]], ["iris", "Iris", ["lead guitar"]], ["felix", "Felix", ["drums"]]] as const)
    ids[key] = (await db.create(sys, "musicians", { name, instruments: [...instruments], active: true })).id;
  await db.create(sys, "artists", {
    slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: {},
    configurations: [
      { id: "duo", name: "Duo", billingName: "Nora Quill Duo", musicianIds: [ids.nora, ids.rudy] },
      { id: "trio", name: "Trio", billingName: "Trio", musicianIds: [ids.nora, ids.rudy, ids.felix] },
      { id: "full-band", name: "Full Band", billingName: "Nora Quill Band", musicianIds: [ids.nora, ids.rudy, ids.hugo, ids.iris, ids.felix] },
    ],
  }, { id: TEST_ARTIST });
}
async function sess() {
  const threadId = newThreadId();
  await ensureThread({ uid: who.uid, threadId, pageContext: { route: "calendar" }, at: new Date() });
  return { ...sessionFor(who, threadId), artistId: TEST_ARTIST };
}
/** One tool call as Roadie runs it. Returns the unwrapped result (or the error / confirm payload) and the whole ToolOut. */
async function tool(s: Awaited<ReturnType<typeof sess>>, name: string, input: unknown) {
  const out = await execTool(s, name, input, noop);
  return { out, data: unwrap(out.output) as Row, confirm: !!(out.output as { needsConfirmation?: boolean }).needsConfirmation, error: (out.output as { error?: { code: string } }).error };
}
const plot = async (id: string) => (await db.get("stagePlots", id))! as Row;
const mkShow = (venue: string, date: string, extra: Row = {}) => db.create(sys, "shows", {
  date, status: "confirmed", artistId: TEST_ARTIST, billedAs: "full-band", personnel: [], sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false },
  docs: [], times: {}, listings: {}, fields: [], venue: { id: `v-${venue}`, name: venue }, ...extra,
}).then((r) => r.id);

/** A five-person plot: kick (Felix), snare (Felix), keys L/R (Rudy), lead amp (Iris), bass DI (Hugo), vocal (Nora), placed on the stage. */
async function fullBand(s: Awaited<ReturnType<typeof sess>>) {
  const made = (await tool(s, "stagePlots.create", { name: "Full band", configurationId: "full-band", inputs: 7 })).data.result;
  const id = made.id as string;
  await tool(s, "stagePlots.updateInputs", { id, inputs: [
    { n: 1, source: "Kick", musicianId: ids.felix }, { n: 2, source: "Snare", musicianId: ids.felix }, { n: 3, source: "Keys L", musicianId: ids.rudy }, { n: 4, source: "Keys R", musicianId: ids.rudy },
    { n: 5, source: "Lead amp", musicianId: ids.iris }, { n: 6, source: "Bass DI", musicianId: ids.hugo }, { n: 7, source: "Nora vox", musicianId: ids.nora },
  ] });
  const p = await plot(id);
  await tool(s, "stagePlots.move", { id, moves: p.inputs.map((i: Row, k: number) => ({ id: i.id, x: 3 + k * 2, y: 6 })) });
  await tool(s, "stagePlots.addItems", { id, items: [{ type: "amp", x: 4, y: 3, musicianId: ids.iris }] });
  return id;
}

// ---------- exposure and policy ----------

const PLOT_COMMANDS = Object.keys(registry).filter((n) => n.startsWith("stagePlots.") || n === "shows.setStagePlot");
const READS = ["stagePlots.list", "stagePlots.get", "stagePlots.staleShows", "stagePlots.engineerLink"];

// ---------- the ten phrases ----------

test('"Make a stage plot for the duo" -> stagePlots.create for the duo lineup, no card', async () => {
  await setup();
  const s = await sess();
  const r = await tool(s, "stagePlots.create", { name: "Duo", configurationId: "duo" });
  assert.equal(r.confirm, false);
  assert.equal(r.error, undefined);
  const made = r.data.result;
  assert.equal(made.summary, "8 inputs, 0 mixes, 0 power drops");
  const p = await plot(made.id);
  assert.equal(p.configurationId, "duo");
  assert.equal(p.inputs.length, 8);
  assert.equal(r.out.action?.kind, "readback");
  assert.match(r.out.action!.label, /Made the stage plot 'Duo': 8 inputs/);
  // a lineup that is not the band's is refused, not guessed
  assert.equal((await tool(s, "stagePlots.create", { name: "Quartet", configurationId: "quartet" })).error?.code, "invalid_input");
});

test('"Rudy\'s keys need a stereo DI and he\'s on in-ears" -> get, updateInputs gear on his keys, an in-ear mix for Rudy', async () => {
  await setup();
  const s = await sess();
  const id = await fullBand(s);
  const got = (await tool(s, "stagePlots.get", { id })).data;
  const keys = (got.inputs as Row[]).filter((i) => i.musicianId === ids.rudy);
  assert.deepEqual(keys.map((k) => k.source), ["Keys L", "Keys R"]);
  const v0 = got.version;
  const up = await tool(s, "stagePlots.updateInputs", { id, inputs: keys.map((k) => ({ n: got.inputs.indexOf(keys.find((x) => x.id === k.id)!) + 1, gear: "Stereo DI" })) });
  assert.equal(up.confirm, false);
  assert.equal(up.error, undefined);
  assert.equal((await tool(s, "stagePlots.setMixCount", { id, count: 1, kind: "iem" })).confirm, false);
  const mon = await tool(s, "stagePlots.setMonitors", { id, monitors: [{ n: 1, kind: "iem", musicianId: ids.rudy }] });
  assert.equal(mon.confirm, false);
  const p = await plot(id);
  assert.deepEqual(p.inputs.filter((i: Row) => i.musicianId === ids.rudy).map((i: Row) => i.gear), ["Stereo DI", "Stereo DI"]);
  assert.equal(p.monitors.length, 1);
  assert.deepEqual([p.monitors[0].kind, p.monitors[0].musicianId], ["iem", ids.rudy]);
  assert.ok(p.version > v0, "inputs and mixes bump the sheet's version");
});

test('"Felix\'s bringing his own kick mic" -> updateInputs on the kick row, one write, no card', async () => {
  await setup();
  const s = await sess();
  const id = await fullBand(s);
  const got = (await tool(s, "stagePlots.get", { id })).data;
  const kick = (got.inputs as Row[]).findIndex((i) => i.musicianId === ids.felix && /kick/i.test(i.source));
  assert.equal(kick, 0);
  const r = await tool(s, "stagePlots.updateInputs", { id, inputs: [{ n: kick + 1, gear: "Felix's own kick mic" }] });
  assert.equal(r.confirm, false);
  assert.equal((await plot(id)).inputs[0].gear, "Felix's own kick mic");
  assert.equal((await plot(id)).inputs[0].source, "Kick", "fields left out stay");
});

test('"Move Iris to stage left" -> one stagePlots.move of everything of hers, to the right side of the drawing (large x)', async () => {
  await setup();
  const s = await sess();
  const id = await fullBand(s);
  const got = (await tool(s, "stagePlots.get", { id })).data;
  const hers = [...(got.inputs as Row[]), ...(got.items as Row[]), ...(got.monitors as Row[])].filter((r) => r.musicianId === ids.iris);
  assert.ok(hers.length >= 1);
  const wide = got.stage.widthFt as number;
  const v0 = got.version;
  const r = await tool(s, "stagePlots.move", { id, moves: hers.map((h, k) => ({ id: h.id, x: wide - 3 - k, y: 8 })) });
  assert.equal(r.confirm, false);
  const p = await plot(id);
  for (const h of [...p.inputs, ...p.items].filter((x: Row) => x.musicianId === ids.iris)) assert.ok(h.x > wide / 2, "stage left is the right half of the drawing");
  assert.equal(p.version, v0, "moving never bumps the version");
});

test('"Make a no-drums version" -> stagePlots.copy dropping the drummer; the original is untouched', async () => {
  await setup();
  const s = await sess();
  const id = await fullBand(s);
  const r = await tool(s, "stagePlots.copy", { id, name: "Full band, no drums", dropMusicianIds: [ids.felix] });
  assert.equal(r.confirm, false);
  assert.equal(r.error, undefined);
  const copy = await plot(r.data.result.id);
  assert.equal(copy.inputs.length, 5);
  assert.ok(!copy.inputs.some((i: Row) => i.musicianId === ids.felix));
  assert.deepEqual(copy.inputs.map((i: Row) => i.source), ["Keys L", "Keys R", "Lead amp", "Bass DI", "Nora vox"]);
  assert.equal(copy.version, 1);
  assert.equal((await plot(id)).inputs.length, 7);
  assert.match(r.out.action!.label, /Copied the stage plot without 1 person: 5 inputs/);
});

test('"Send the stage plot to Top Hat" -> no tool exists for it; the canned reply is honest and offers the PDF or the engineer link', async () => {
  await setup();
  assert.deepEqual(PLOT_COMMANDS.filter((n) => /send|email|draft/i.test(n)), [], "email is out of V1: no send command");
  assert.deepEqual(toolDefs("admin").filter((t) => /stagePlot/i.test(t.name) && /send|email|draft/i.test(t.name)), []);
  for (const t of ["Send the stage plot to Top Hat", "send the stage plot to Top Hat.", "Email the stage plot to the Roots", "can you send the plot to Top Hat?"]) {
    const r = script({ text: t });
    assert.equal(r.text, PLOT_NOT_SENT, t);
    assert.equal(r.calls, undefined, `${t}: no tool call`);
    assert.notEqual(r.text, CANT_DO);
  }
  assert.match(PLOT_NOT_SENT, /PDF/);
  assert.match(PLOT_NOT_SENT, /engineer link/);
  assert.match(PLOT_NOT_SENT, /can't send/);
});

test('"Use the no-drums plot for the Roots show" -> shows.setStagePlot on that show only, no card', async () => {
  await setup();
  const s = await sess();
  const id = await fullBand(s);
  const noDrums = (await tool(s, "stagePlots.copy", { id, name: "No drums", dropMusicianIds: [ids.felix] })).data.result.id as string;
  const roots = await mkShow("The Roots Room", "2099-03-01");
  const tophat = await mkShow("Top Hat", "2099-03-12", { stagePlotId: id });
  const listed = (await tool(s, "stagePlots.list", {})).data.plots as Row[];
  assert.equal(listed.find((p) => p.name === "No drums")!.id, noDrums, "Roadie finds the plot by name in the list");
  const r = await tool(s, "shows.setStagePlot", { showId: roots, stagePlotId: noDrums });
  assert.equal(r.confirm, false);
  assert.equal(r.error, undefined);
  assert.equal((await db.get("shows", roots))!.stagePlotId, noDrums);
  assert.equal((await db.get("shows", tophat))!.stagePlotId, id, "other shows keep theirs");
  assert.match(r.out.action!.label, /Picked a stage plot for/);
});

test('"Who still needs the new plot?" -> stagePlots.staleShows (a read); the canned model asks it and names the shows', async () => {
  await setup();
  const s = await sess();
  const id = await fullBand(s);
  await tool(s, "stagePlots.create", { name: "Duo", configurationId: "duo" });
  await mkShow("Top Hat", "2099-03-12"); // full band has a plot, none picked
  await mkShow("Bluebird", "2099-04-01", { billedAs: "duo" }); // duo plot exists, none picked
  await mkShow("Heron Theatre", "2099-05-01", { stagePlotId: id }); // fine
  const first = script({ text: "Who still needs the new plot?" });
  assert.deepEqual(first.calls, [{ name: "stagePlots.staleShows", input: {} }]);
  const r = await tool(s, "stagePlots.staleShows", {});
  assert.equal(r.confirm, false);
  assert.equal(r.data.count, 2);
  assert.deepEqual((r.data.shows as Row[]).map((x) => [x.name.includes("Top Hat"), x.reason]).sort(), [[false, "noPlot"], [true, "noPlot"]]);
  const reply = script({ text: "Who still needs the new plot?", steps: [{ name: "stagePlots.staleShows", input: {}, output: r.out.output }] });
  assert.match(reply.text!, /^2 shows need a plot: .*Top Hat/);
});

test('"How many inputs is the trio?" -> stagePlots.list (a read); the canned model asks it and answers from summary.inputs', async () => {
  await setup();
  const s = await sess();
  const trio = (await tool(s, "stagePlots.create", { name: "Trio", configurationId: "trio", inputs: 11 })).data.result.id;
  await tool(s, "stagePlots.create", { name: "Duo", configurationId: "duo" });
  assert.deepEqual(script({ text: "How many inputs is the trio?" }).calls, [{ name: "stagePlots.list", input: {} }]);
  const r = await tool(s, "stagePlots.list", {});
  assert.equal(r.confirm, false);
  assert.equal((r.data.plots as Row[]).find((p) => p.id === trio)!.summary.inputs, 11);
  // the same answer from the lineup filter
  const only = (await tool(s, "stagePlots.list", { configurationId: "trio" })).data;
  assert.equal(only.count, 1);
  const reply = script({ text: "How many inputs is the trio?", steps: [{ name: "stagePlots.list", input: {}, output: r.out.output }] });
  assert.equal(reply.text, "Trio has 11 inputs.");
  const none = script({ text: "How many inputs is the quartet?", steps: [{ name: "stagePlots.list", input: {}, output: r.out.output }] });
  assert.match(none.text!, /don't have a stage plot/);
});

test('"Give me the engineer link for tonight" -> the show\'s plot, then the link; turning a link ON asks first, nothing changes until yes', async () => {
  await setup();
  const s = await sess();
  const id = await fullBand(s);
  const tonight = await mkShow("Top Hat", "2099-03-12", { stagePlotId: id });
  // Roadie finds tonight's show (context.now / search), reads its stagePlotId, then asks for that plot's link.
  assert.equal((await db.get("shows", tonight))!.stagePlotId, id);
  if (registry["stagePlots.engineerLink"]) {
    // member-readable read: never asks; works whether or not the link is on (the other agent's command decides what it returns)
    assert.ok(registry["stagePlots.engineerLink"].roles.includes("member"));
    assert.ok(registry["stagePlots.engineerLink"].roles.includes("mcp"));
    const r = await tool(s, "stagePlots.engineerLink", { id });
    assert.equal(r.confirm, false);
  }
  // Link off: turning it on is a public link, so it stops at a card.
  const on = await tool(s, "stagePlots.shareLink", { id });
  assert.equal(on.confirm, true);
  assert.equal(on.out.action?.kind, "confirm");
  assert.match(on.out.action!.label, /public engineer link/);
  assert.notEqual((await plot(id)).share?.on, true, "nothing is on until the person taps Yes");
  // Same for turning it off and for archiving.
  assert.equal((await tool(s, "stagePlots.shareOff", { id })).confirm, true);
  const rm = await tool(s, "stagePlots.remove", { id });
  assert.equal(rm.confirm, true);
  assert.ok(!(await plot(id)).deletedAt, "nothing is archived until the person taps Yes");
});

// ---------- readbacks ----------

test("readbacks name the change in the band's words, not the command", async () => {
  await setup();
  const s = await sess();
  const r = (name: string, input: Row, result: Row = {}) => readback(name, input, result, s);
  assert.equal(await r("stagePlots.setInputCount", { count: 12 }), "Set the stage plot to 12 inputs");
  assert.equal(await r("stagePlots.setMixCount", { count: 1 }), "Set the stage plot to 1 monitor mix");
  assert.equal(await r("stagePlots.setStage", { widthFt: 20, depthFt: 14 }), "Set the stage to 20 x 14 ft");
  assert.equal(await r("stagePlots.shareOff", {}), "Turned off the engineer link");
  assert.equal(await r("stagePlots.remove", {}), "Archived the stage plot");
  for (const n of PLOT_COMMANDS.filter((c) => !READS.includes(c))) assert.doesNotMatch(await r(n, { inputs: [], moves: [], items: [], ids: [], monitors: [] }), /^Ran /, `${n} has a readback`);
});
