import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStagePlotPdf, plotFileName } from "@/server/stagePlotPdf";
import { channelRows, mixRows, parsePaper } from "@/lib/stagePlots/sheet";
import type { SheetPlot } from "@/lib/stagePlots/sheet";

const plot = (n: number, mixes = 2): SheetPlot => ({
  name: "Full band", version: 3, stage: { widthFt: 24, depthFt: 16 },
  inputs: Array.from({ length: n }, (_, i) => ({ id: `i${i}`, source: `Source ${i + 1}`, gear: "SM57", phantom: i % 4 === 0, ...(i % 3 ? { x: 2 + (i % 10) * 2, y: 3 + Math.floor(i / 10) * 3 } : {}) })),
  items: [{ id: "g1", type: "kit", x: 12, y: 4, rot: 0 }],
  monitors: Array.from({ length: mixes }, (_, i) => ({ id: `m${i}`, kind: "wedge" as const, wants: "Bass, keys", ...(i ? { x: 3, y: 12 } : {}) })),
  bring: "Keys rig", need: "Four wedges",
});
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

test("the PDF is a one-page %PDF for Letter and A4, even with a full channel list", async () => {
  for (const paper of ["letter", "a4"] as const) {
    for (const n of [0, 8, 32, 64]) {
      const pdf = await buildStagePlotPdf({ plot: plot(n), artist: "Ingrid Avison Band", lineupName: "Full Band", paper });
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assert.equal(pages(pdf), 1, `${paper} with ${n} inputs`);
    }
  }
});

test("the sheet rows mark unplaced inputs and resolve names; file name and paper parse", () => {
  const rows = channelRows(plot(3), {});
  assert.deepEqual(rows.map((r) => r.placed), [false, true, true]);
  assert.equal(rows[0].phantom, true);
  assert.deepEqual(mixRows(plot(0, 2), {}).map((r) => [r.n, r.placed]), [[1, false], [2, true]]);
  assert.equal(channelRows({ ...plot(1), inputs: [{ id: "a", musicianId: "m1" }] }, { m1: "Eric" })[0].who, "Eric");
  assert.equal(plotFileName({ name: "Full Band (2026)!", version: 3 }), "full-band-2026-v3.pdf");
  assert.equal(parsePaper("a4"), "a4");
  assert.equal(parsePaper("legal"), "letter");
});
