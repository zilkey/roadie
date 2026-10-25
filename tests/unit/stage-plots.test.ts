import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setInputCount, setMixCount, placeInput, unplaceInput, reorderInputs, clampToStage, unplaced, summary, range, fanOut, applyMoves, dropsWork, MARKER_FT, isPlaced,
} from "@/lib/stagePlots/plot";
import type { PlotShape } from "@/schema/stagePlots";

let n = 0;
const mk = (p: string) => `${p}${++n}`;
const plot = (inputs = 8): PlotShape => ({ stage: { widthFt: 24, depthFt: 16 }, inputs: setInputCount({ inputs: [] }, inputs, mk).inputs, items: [], monitors: [] });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test("going from 8 to 10 inputs adds two unplaced inputs at the end", () => {
  const p = plot(8);
  const q = setInputCount(p, 10, mk);
  assert.equal(q.inputs.length, 10);
  assert.deepEqual(q.inputs.slice(0, 8), p.inputs);
  assert.ok(q.inputs.slice(8).every((i) => !isPlaced(i)));
  assert.equal(p.inputs.length, 8, "the original is untouched");
});

test("going from 10 to 8 removes inputs 9 and 10", () => {
  const p = plot(10);
  const q = setInputCount(p, 8);
  assert.deepEqual(q.inputs.map((i) => i.id), p.inputs.slice(0, 8).map((i) => i.id));
});

test("dropsWork lists only the doomed inputs that are placed or filled in", () => {
  let p = plot(10);
  p = placeInput(p, p.inputs[9].id, 5, 5);
  p = { ...p, inputs: p.inputs.map((i, k) => (k === 8 ? { ...i, source: "Kick" } : i)) };
  assert.deepEqual(dropsWork(p, 8).map((i) => i.id), [p.inputs[8].id, p.inputs[9].id]);
  assert.deepEqual(dropsWork(p, 9).map((i) => i.id), [p.inputs[9].id]);
  assert.deepEqual(dropsWork(plot(10), 8), []);
});

test("setMixCount adds unplaced mixes of a kind and drops from the end", () => {
  const p = setMixCount(plot(), 3, "iem", mk);
  assert.deepEqual(p.monitors.map((m) => m.kind), ["iem", "iem", "iem"]);
  assert.equal(setMixCount(p, 1).monitors[0].id, p.monitors[0].id);
});

test("placeInput clamps to the stage; unplaceInput sends the circle back and keeps the details", () => {
  let p = plot();
  const id = p.inputs[0].id;
  p = { ...p, inputs: p.inputs.map((i) => (i.id === id ? { ...i, source: "Kick" } : i)) };
  p = placeInput(p, id, 99, -4);
  assert.deepEqual([p.inputs[0].x, p.inputs[0].y], [23.7, 0.3]);
  p = unplaceInput(p, id);
  assert.equal(isPlaced(p.inputs[0]), false);
  assert.equal(p.inputs[0].source, "Kick");
  assert.throws(() => placeInput(p, "nope", 1, 1));
});

test("reorderInputs keeps each input's position, so circles renumber in place", () => {
  let p = plot(3);
  const [a, b, c] = p.inputs.map((i) => i.id);
  p = placeInput(placeInput(p, a, 2, 2), b, 8, 9);
  const q = reorderInputs(p, [c, b, a]);
  assert.deepEqual(q.inputs.map((i) => i.id), [c, b, a]);
  assert.deepEqual([q.inputs[2].x, q.inputs[2].y], [2, 2]);
  assert.deepEqual([q.inputs[1].x, q.inputs[1].y], [8, 9]);
  assert.throws(() => reorderInputs(p, [a, b]), /every input/);
  assert.throws(() => reorderInputs(p, [a, a, b]), /every input/);
});

test("a placement stays on the stage when the stage shrinks", () => {
  let p = plot(2);
  p = placeInput(p, p.inputs[0].id, 22, 14);
  p = { ...p, items: [{ id: "g1", type: "amp", x: 20, y: 12, rot: 0 }] };
  const q = clampToStage({ ...p, stage: { widthFt: 16, depthFt: 12 } });
  assert.deepEqual([q.inputs[0].x, q.inputs[0].y], [15.7, 11.7]);
  assert.deepEqual([q.items[0].x, q.items[0].y], [15.7, 11.7]);
  assert.equal(isPlaced(q.inputs[1]), false, "unplaced stays unplaced");
});

test("unplaced lists the circles still in the strip, numbered", () => {
  let p = setMixCount(plot(4), 2, "wedge", mk);
  p = placeInput(p, p.inputs[1].id, 3, 3);
  const u = unplaced(p);
  assert.deepEqual(u.inputs.map((r) => r.n), [1, 3, 4]);
  assert.deepEqual(u.mixes.map((r) => r.n), [1, 2]);
});

test("applyMoves places inputs, gear and mixes together; x null unplaces; gear cannot be unplaced", () => {
  let p = setMixCount(plot(2), 1, "wedge", mk);
  p = { ...p, items: [{ id: "g1", type: "kit", x: 10, y: 4, rot: 0 }] };
  const q = applyMoves(p, [{ id: p.inputs[0].id, x: 5, y: 6 }, { id: "g1", x: 12, rot: 45 }, { id: p.monitors[0].id, x: 1, y: 1 }]);
  assert.deepEqual([q.inputs[0].x, q.inputs[0].y], [5, 6]);
  assert.deepEqual([q.items[0].x, q.items[0].y, q.items[0].rot], [12, 4, 45]);
  assert.equal(isPlaced(q.monitors[0]), true);
  assert.equal(isPlaced(applyMoves(q, [{ id: q.inputs[0].id, x: null }]).inputs[0]), false);
  assert.throws(() => applyMoves(q, [{ id: "g1", x: null }]), /remove it/);
  assert.throws(() => applyMoves(q, [{ id: "zzz", x: 1, y: 1 }]), /Nothing with id/);
});

test("summary counts inputs, placed, mixes and power drops", () => {
  let p = setMixCount(plot(11), 3, "wedge", mk);
  p = { ...p, items: ["power", "power", "power", "amp"].map((type, k) => ({ id: `g${k}`, type: type as "power", x: 1, y: 1, rot: 0 })) };
  p = placeInput(p, p.inputs[0].id, 1, 1);
  const s = summary(p);
  assert.equal(s.text, "11 inputs, 3 mixes, 3 power drops");
  assert.deepEqual([s.inputs, s.placed, s.unplaced, s.mixes, s.powerDrops], [11, 1, 10, 3, 3]);
  assert.equal(summary(plot(1)).text, "1 input, 0 mixes, 0 power drops");
});

test("range formats runs and gaps like the design", () => {
  assert.equal(range([3]), "3");
  assert.equal(range([1, 2, 3, 4]), "1–4");
  assert.equal(range([1, 2, 5]), "1·2·5");
});

test("fanOut separates circles that would overlap and leaves distant ones exactly alone", () => {
  const pts = [
    { id: "a", x: 10, y: 5 }, { id: "b", x: 10, y: 5 }, { id: "c", x: 10.2, y: 5.1 }, { id: "d", x: 10.1, y: 4.9 },
    { id: "far", x: 20, y: 12 },
  ];
  const out = fanOut(pts);
  assert.equal(out.length, pts.length);
  assert.deepEqual(out.map((o) => o.id), pts.map((o) => o.id), "order is kept");
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(dist(out[i], out[j]) >= MARKER_FT - 1e-6, `${out[i].id}-${out[j].id}`);
  assert.deepEqual(out[4], pts[4]);
  assert.deepEqual(fanOut(pts), out, "deterministic");
  assert.equal(pts[0].x, 10, "inputs are not mutated");
});

test("fanOut leaves a spread-out set untouched", () => {
  const pts = [{ id: "a", x: 1, y: 1 }, { id: "b", x: 3, y: 1 }, { id: "c", x: 5, y: 4 }];
  assert.deepEqual(fanOut(pts), pts);
});

test("StagePlotSvg renders on the server: placed things only, numbered, with hooks for the editor", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { StagePlotSvg } = await import("@/components/stagePlots/StagePlotSvg");
  let p = setMixCount(plot(3), 1, "wedge", mk);
  p = { ...p, inputs: p.inputs.map((i, k) => (k === 0 ? { ...i, source: "Kick" } : i)), items: [{ id: "gk", type: "kit", x: 12, y: 4, rot: 0 }, { id: "gr", type: "riser", x: 12, y: 4, rot: 0 }] };
  p = placeInput(placeInput(p, p.inputs[0].id, 12, 4), p.inputs[1].id, 12, 4); // same spot: fanned
  p = { ...p, monitors: p.monitors.map((m) => ({ ...m, x: 3, y: 3 })) };
  const html = renderToStaticMarkup(createElement(StagePlotSvg, { plot: p, forPaper: true, highlight: p.inputs[0].id }, createElement("g", { id: "overlay" })));
  assert.match(html, /^<svg /);
  assert.match(html, /AUDIENCE/);
  assert.match(html, new RegExp(`data-input-id="${p.inputs[0].id}"`));
  assert.match(html, new RegExp(`data-input-id="${p.inputs[1].id}"`));
  assert.doesNotMatch(html, new RegExp(`data-input-id="${p.inputs[2].id}"`), "unplaced is not drawn");
  assert.match(html, /data-monitor-id=/);
  assert.match(html, />M1</);
  assert.match(html, /data-leader-for=/, "the fanned circle gets a leader line to its true spot");
  assert.ok(html.indexOf('data-item-id="gr"') < html.indexOf('data-item-id="gk"'), "riser under the kit");
  assert.ok(html.indexOf("data-layer=\"gear\"") < html.indexOf("data-layer=\"markers\""));
  assert.doesNotMatch(html, /var\(|currentColor/, "paper mode has literal colors only");
  assert.match(html, /id="overlay"/);
  assert.equal(p.inputs[1].x, 12, "stored positions untouched");
});
