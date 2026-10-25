import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { plotByToken } from "@/server/stagePlotShare";
import { resetEmulators, makeUser, makeArtist, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);
type Out = { status: number; json: { result: any } };
const call = (tok: string, name: string, body: unknown) => dispatch(name, `Bearer ${tok}`, body, TEST_ARTIST) as Promise<Out>;
const sys = importCtx();

async function setup() {
  await makeArtist("Ingrid Avison Band", "ingrid-avison-band");
  const jeff = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  const david = await makeUser("david@example.com", "member", { name: "David" });
  const eric = (await db.create(sys, "musicians", { name: "Eric", instruments: ["drums"], active: true })).id;
  const ingrid = (await db.create(sys, "musicians", { name: "Ingrid", instruments: ["vocals"], active: true })).id;
  await db.update(sys, "artists", TEST_ARTIST, { configurations: [
    { id: "full", name: "Full Band", billingName: "IAB", musicianIds: [eric, ingrid] }, { id: "duo", name: "Duo", billingName: "IAB Duo", musicianIds: [ingrid] },
  ] });
  const r = await call(jeff.token, "stagePlots.create", { name: "Full band", configurationId: "full" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { jeff, david, eric, ingrid, id: r.json.result.id as string };
}
const get = async (tok: string, id: string) => (await call(tok, "stagePlots.get", { id })).json.result;

test("create makes 8 unplaced inputs by default, version 1, and a copy starts from another plot", async () => {
  const { jeff, id } = await setup();
  const p = await get(jeff.token, id);
  assert.equal(p.inputs.length, 8);
  assert.equal(p.version, 1);
  assert.equal(p.summary.text, "8 inputs, 0 mixes, 0 power drops");
  assert.equal(p.notPlaced.length, 8);
  const c = await call(jeff.token, "stagePlots.create", { name: "Copy", copyFrom: id });
  assert.equal(c.json.result.summary, "8 inputs, 0 mixes, 0 power drops");
  assert.notEqual((await get(jeff.token, c.json.result.id)).inputs[0].id, p.inputs[0].id, "copies get new ids");
  assert.equal((await call(jeff.token, "stagePlots.create", { name: "Bad", configurationId: "nope" })).status, 400);
  assert.equal((await call(jeff.token, "stagePlots.create", { name: "Five", inputs: 5 })).json.result.summary.startsWith("5 inputs"), true);
});

test("version bumps on inputs, mixes, bring/need and stage size, never on move, gear or rename", async () => {
  const { jeff, id } = await setup();
  const v = async () => (await get(jeff.token, id)).version;
  assert.equal((await call(jeff.token, "stagePlots.setInputCount", { id, count: 10 })).json.result.version, 2);
  await call(jeff.token, "stagePlots.setInputCount", { id, count: 10 });
  assert.equal(await v(), 2, "same count: no change, no bump");
  await call(jeff.token, "stagePlots.setMixCount", { id, count: 2 });
  assert.equal(await v(), 3);
  await call(jeff.token, "stagePlots.updateInputs", { id, inputs: [{ n: 1, source: "Kick", gear: "Beta 52", phantom: false }] });
  assert.equal(await v(), 4);
  await call(jeff.token, "stagePlots.updateInputs", { id, inputs: [{ n: 1, source: "Kick" }] });
  assert.equal(await v(), 4, "unchanged text does not bump");
  await call(jeff.token, "stagePlots.setBringNeed", { id, bring: "Keys rig", need: "4 wedges" });
  assert.equal(await v(), 5);
  await call(jeff.token, "stagePlots.setMonitors", { id, monitors: [{ n: 1, kind: "iem", wants: "Keys" }] });
  assert.equal(await v(), 6);
  await call(jeff.token, "stagePlots.setStage", { id, widthFt: 20, depthFt: 14 });
  assert.equal(await v(), 7);
  const p = await get(jeff.token, id);
  await call(jeff.token, "stagePlots.reorderInputs", { id, order: [...p.inputs.map((i: any) => i.id)].reverse() });
  assert.equal(await v(), 8);
  // none of these touch the version
  await call(jeff.token, "stagePlots.move", { id, moves: [{ id: p.inputs[0].id, x: 4, y: 4 }] });
  const added = await call(jeff.token, "stagePlots.addItems", { id, items: [{ type: "power", x: 2, y: 2 }] });
  await call(jeff.token, "stagePlots.removeItems", { id, ids: added.json.result.ids });
  await call(jeff.token, "stagePlots.rename", { id, name: "Full band v2" });
  assert.equal(await v(), 8);
  assert.equal((await get(jeff.token, id)).name, "Full band v2");
});

test("lowering the input count removes the highest numbers and reports what had work in it", async () => {
  const { jeff, id } = await setup();
  const p = await get(jeff.token, id);
  await call(jeff.token, "stagePlots.updateInputs", { id, inputs: [{ n: 8, source: "OH R" }] });
  const r = await call(jeff.token, "stagePlots.setInputCount", { id, count: 6 });
  assert.deepEqual(r.json.result.dropped, [{ n: 8, source: "OH R" }]);
  assert.deepEqual((await get(jeff.token, id)).inputs.map((i: any) => i.id), p.inputs.slice(0, 6).map((i: any) => i.id));
  assert.equal((await call(jeff.token, "stagePlots.updateInputs", { id, inputs: [{ n: 7, source: "x" }] })).status, 404);
});

test("move is ONE write across inputs, gear and mixes; x null unplaces", async () => {
  const { jeff, id } = await setup();
  await call(jeff.token, "stagePlots.setMixCount", { id, count: 1 });
  const g = await call(jeff.token, "stagePlots.addItems", { id, items: [{ type: "kit", x: 12, y: 3 }] });
  const p = await get(jeff.token, id);
  const before = (await db.history("stagePlots", id)).length;
  const r = await call(jeff.token, "stagePlots.move", { id, moves: [
    { id: p.inputs[0].id, x: 11, y: 3 }, { id: p.inputs[1].id, x: 12, y: 3 }, { id: g.json.result.ids[0], x: 13, rot: 90 }, { id: p.monitors[0].id, x: 2, y: 8 },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await db.history("stagePlots", id)).length, before + 1, "one history entry");
  const q = await get(jeff.token, id);
  assert.deepEqual([q.inputs[0].x, q.inputs[1].x, q.items[0].x, q.items[0].rot, q.monitors[0].y], [11, 12, 13, 90, 8]);
  assert.deepEqual(q.notPlaced, [3, 4, 5, 6, 7, 8]);
  await call(jeff.token, "stagePlots.move", { id, moves: [{ id: p.inputs[0].id, x: null }] });
  assert.equal((await get(jeff.token, id)).inputs[0].x, undefined);
  assert.equal((await call(jeff.token, "stagePlots.move", { id, moves: [{ id: "nope", x: 1, y: 1 }] })).status, 400);
  assert.equal(q.version, 2, "only setMixCount bumped it");
});

test("copy can drop a musician's inputs, mixes and gear; the channels renumber", async () => {
  const { jeff, eric, ingrid, id } = await setup();
  await call(jeff.token, "stagePlots.setInputCount", { id, count: 4 });
  await call(jeff.token, "stagePlots.updateInputs", { id, inputs: [{ n: 1, source: "Kick", musicianId: eric }, { n: 2, source: "Snare", musicianId: eric }, { n: 3, source: "Ingrid vox", musicianId: ingrid }, { n: 4, source: "Acoustic DI", musicianId: ingrid }] });
  await call(jeff.token, "stagePlots.addItems", { id, items: [{ type: "kit", x: 12, y: 3, musicianId: eric }, { type: "amp", x: 4, y: 4 }] });
  const c = await call(jeff.token, "stagePlots.copy", { id, name: "No drums", dropMusicianIds: [eric], configurationId: "duo" });
  const p = await get(jeff.token, c.json.result.id);
  assert.deepEqual(p.inputs.map((i: any) => i.source), ["Ingrid vox", "Acoustic DI"]);
  assert.equal(p.items.length, 1);
  assert.equal(p.configurationId, "duo");
  assert.equal(p.version, 1);
  assert.equal((await get(jeff.token, id)).inputs.length, 4, "the original is untouched");
});

test("roles: admin and mcp write, members read, only admins remove", async () => {
  const { jeff, david, id } = await setup();
  assert.equal((await call(david.token, "stagePlots.get", { id })).status, 200);
  assert.equal((await call(david.token, "stagePlots.list", {})).json.result.count, 1);
  for (const [name, body] of [["stagePlots.setInputCount", { id, count: 3 }], ["stagePlots.move", { id, moves: [{ id: "x", x: 1, y: 1 }] }], ["stagePlots.create", { name: "x" }], ["stagePlots.shareLink", { id }], ["stagePlots.remove", { id }]] as const) {
    assert.equal((await call(david.token, name, body)).status, 403, name);
  }
  const l = (await call(jeff.token, "stagePlots.list", {})).json.result;
  assert.equal(l.plots[0].summary.text, "8 inputs, 0 mixes, 0 power drops");
  assert.equal((await call(jeff.token, "stagePlots.list", { configurationId: "duo" })).json.result.count, 0);
});

test("shows.setStagePlot picks by hand; staleShows lists upcoming shows that need a plot", async () => {
  const { jeff, id } = await setup();
  const show = (date: string, extra: Record<string, unknown> = {}) => db.create(sys, "shows", {
    date, status: "confirmed", artistId: TEST_ARTIST, billedAs: "full", personnel: [], sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false },
    docs: [], times: {}, listings: {}, fields: [], venue: { id: "v", name: "Top Hat" }, ...extra,
  });
  const upcoming = await show("2099-01-10");
  await show("2000-01-10"); // past: never listed
  await show("2099-02-01", { billedAs: "duo" }); // no plot for the duo
  const stale = async () => (await call(jeff.token, "stagePlots.staleShows", {})).json.result;
  let s = await stale();
  assert.deepEqual(s.shows.map((x: any) => [x.showId, x.reason, x.suggestPlotId]), [[upcoming.id, "noPlot", id]]);
  assert.equal((await call(jeff.token, "shows.setStagePlot", { showId: upcoming.id, stagePlotId: id })).status, 200);
  assert.equal((await db.get("shows", upcoming.id))!.stagePlotId, id);
  assert.equal((await stale()).count, 0);
  assert.equal((await call(jeff.token, "shows.setStagePlot", { showId: upcoming.id, stagePlotId: "nope" })).status, 404);
  // removing the plot clears the pick and the show is flagged again
  await call(jeff.token, "stagePlots.remove", { id });
  assert.equal((await db.get("shows", upcoming.id))!.stagePlotId, undefined);
  assert.equal((await call(jeff.token, "stagePlots.get", { id })).status, 404);
  s = await stale();
  assert.equal(s.count, 0, "with the only plot gone there is nothing to suggest");
});

test("engineer link: one stable url while on, hash on the plot, plain token only server-side, off kills it, on again makes a new token", async () => {
  const { jeff, david, id } = await setup();
  const link = async (tok: string) => (await call(tok, "stagePlots.engineerLink", { id })).json.result;
  assert.deepEqual(await link(david.token), { id, on: false, url: null }, "off: nothing to copy");

  const on = (await call(jeff.token, "stagePlots.shareLink", { id })).json.result;
  assert.equal(on.on, true);
  assert.match(on.url, new RegExp(`/plot/${id}/[A-Za-z0-9_-]{20,}$`));
  const token1 = on.url.split("/").pop() as string;
  const raw = (await db.get("stagePlots", id))!;
  assert.equal(raw.share.on, true);
  assert.ok(raw.share.tokenHash && !JSON.stringify(raw).includes(token1), "the plot document holds only a hash");
  assert.equal((await db.get("stagePlotTokens", id))!.token, token1, "the plain token is in the server-only collection");
  for (const who of [jeff, david]) assert.deepEqual((await get(who.token, id)).share, { on: true }, "reads never carry the hash");

  // members can read the same url to copy it; they cannot turn it on or off
  assert.equal((await link(david.token)).url, on.url);
  assert.equal((await link(jeff.token)).url, on.url);
  assert.equal((await call(david.token, "stagePlots.shareLink", { id })).status, 403);
  assert.equal((await call(david.token, "stagePlots.shareOff", { id })).status, 403);

  const view = await plotByToken(id, token1);
  assert.equal(view.name, "Full band");
  assert.equal(view.share, undefined);
  await assert.rejects(plotByToken(id, "wrong"), /not valid/);
  await assert.rejects(plotByToken("nope", token1), /not valid/);

  // asking again returns the same link and changes nothing
  const again = (await call(jeff.token, "stagePlots.shareLink", { id })).json.result;
  assert.deepEqual([again.alreadyOn, again.url], [true, on.url]);
  await plotByToken(id, token1);

  assert.equal((await call(jeff.token, "stagePlots.shareOff", { id })).json.result.on, false);
  await assert.rejects(plotByToken(id, token1), /not valid/);
  assert.equal(await db.get("stagePlotTokens", id), null, "the token is deleted");
  assert.deepEqual(await link(david.token), { id, on: false, url: null });
  const second = (await call(jeff.token, "stagePlots.shareLink", { id })).json.result;
  const token2 = second.url.split("/").pop() as string;
  assert.notEqual(token2, token1);
  await assert.rejects(plotByToken(id, token1), /not valid/);
  await plotByToken(id, token2);
  const rotated = (await call(jeff.token, "stagePlots.shareLink", { id, rotate: true })).json.result;
  assert.notEqual(rotated.url, second.url);
  await assert.rejects(plotByToken(id, token2), /not valid/);
  await plotByToken(id, rotated.url.split("/").pop());
  assert.equal((await link(david.token)).url, rotated.url);

  // archiving the plot kills the link and the stored token
  await call(jeff.token, "stagePlots.remove", { id });
  await assert.rejects(plotByToken(id, rotated.url.split("/").pop()), /not valid/);
  assert.equal(await db.get("stagePlotTokens", id), null);
});
