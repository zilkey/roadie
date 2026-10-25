import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { callerArtistId } from "../venues";
import type { Ctx } from "../ctx";
import { plotLink, newToken, saveToken, readToken, deleteToken } from "../stagePlotShare";
import { hashToken } from "../availability";
import { ICON_TYPES } from "@/lib/stagePlots/icons";
import {
  DEFAULT_STAGE, MAX_INPUTS, MAX_MIXES, applyMoves, clampToStage, dropsWork, newId, reorderInputs, setInputCount, setMixCount, summary, unplaced, type Move,
} from "@/lib/stagePlots/plot";
import { monitorKind, type PlotShape, type StagePlotInput, type StagePlotItem, type StagePlotMonitor } from "@/schema/stagePlots";
import { showName } from "@/lib/shows";
import { todayStr } from "@/lib/booking";

const id = z.string().min(1);
const nullableStr = z.string().nullable().optional();

// ---------- helpers ----------

/** A plot as the reads return it: never the stored token hash, only whether the link is on. */
function present(p: Doc) {
  const { share, ...rest } = p;
  return { ...rest, share: { on: !!share?.on } };
}
const shapeOf = (p: Doc): PlotShape => ({ stage: p.stage, inputs: p.inputs ?? [], items: p.items ?? [], monitors: p.monitors ?? [] });
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function loadPlot(w: Writer, ctx: Ctx, plotId: string): Promise<Doc> {
  const p = await w.get("stagePlots", plotId);
  const artistId = ctx.artistId;
  if (!p || p.deletedAt || (artistId && p.artistId && p.artistId !== artistId)) throw new AppError("not_found", `Stage plot ${plotId} not found`, 404);
  return p;
}
/** Save changed fields. `bump` raises version (inputs, mixes, bring/need, stage size only); nothing is written if nothing changed. */
async function save(w: Writer, before: Doc, patch: Record<string, unknown>, bump: boolean) {
  const changed = Object.keys(patch).filter((k) => !sameJson(before[k], patch[k]));
  if (!changed.length) return { id: before.id, changed: false, version: before.version as number };
  const version = bump ? (before.version as number) + 1 : (before.version as number);
  const clean = Object.fromEntries(changed.map((k) => [k, patch[k]]));
  await w.update("stagePlots", before.id, { ...clean, ...(bump ? { version } : {}) });
  return { id: before.id, changed: true, version };
}
async function checkMusicians(w: Writer, ids: (string | null | undefined)[]) {
  for (const m of new Set(ids.filter((x): x is string => !!x))) {
    const d = await w.get("musicians", m);
    if (!d || d.deletedAt) throw new AppError("not_found", `Musician ${m} not found`, 404);
  }
}
const withText = (p: Doc) => {
  return { summary: summary(shapeOf(p)), notPlaced: unplaced(shapeOf(p)).inputs.map((r) => r.n) };
};
/** Apply a nullable patch to a row: null removes the field, undefined leaves it. */
function patchRow<T extends Record<string, unknown>>(row: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete out[k]; else if (v !== undefined) out[k] = v; }
  return out as T;
}
async function checkLineup(ctx: Ctx, configurationId: string | undefined) {
  if (!configurationId) return;
  const artistId = await callerArtistId(ctx);
  const artist = artistId ? await db.get("artists", artistId) : null;
  if (artist && !(artist.configurations ?? []).some((c: { id: string }) => c.id === configurationId))
    throw new AppError("invalid_input", `No lineup "${configurationId}" (see context.now artist.configurations)`, 400);
}

const stageIn = z.strictObject({ widthFt: z.number().positive().max(100), depthFt: z.number().positive().max(100) });
const inputFields = {
  source: nullableStr, gear: nullableStr, stand: nullableStr, note: nullableStr,
  phantom: z.boolean().nullable().optional(), musicianId: nullableStr,
};

/** A copy of a plot's content with fresh ids; musicians in `drop` lose their inputs, mixes and gear. No share, version 1. */
function cloneContent(src: Doc, drop: string[] = []) {
  const gone = new Set(drop);
  const keep = <T extends { musicianId?: string }>(r: T) => !(r.musicianId && gone.has(r.musicianId));
  return {
    stage: src.stage,
    inputs: (src.inputs as StagePlotInput[]).filter(keep).map((i) => ({ ...i, id: newId("i") })),
    items: (src.items as StagePlotItem[]).filter(keep).map((i) => ({ ...i, id: newId("g") })),
    monitors: (src.monitors as StagePlotMonitor[]).filter(keep).map((m) => ({ ...m, id: newId("m") })),
    ...(src.bring ? { bring: src.bring } : {}), ...(src.need ? { need: src.need } : {}),
  };
}

// ---------- create / copy / rename / remove ----------

export const stagePlotsCreate = defineCommand({
  name: "stagePlots.create",
  roles: ["admin", "mcp"],
  description:
    "Make a stage plot. `inputs` is how many input channels (default 8): that many numbered circles wait, unplaced, for someone to drag onto the stage (or for stagePlots.move). " +
    "Or give `copyFrom` (a plot id) to start from a copy of another plot: its inputs, gear, mixes, stage and bring/need, with new ids. " +
    "configurationId is the lineup it is for (a label and filter; ids are in context.now artist.configurations). The stage starts 24 x 16 ft. Returns {id, version, summary}. " +
    "For \"the same without the drummer\" use stagePlots.copy.",
  input: z.strictObject({ name: z.string().min(1), configurationId: id.optional(), inputs: z.number().int().min(0).max(MAX_INPUTS).optional(), copyFrom: id.optional() }),
  async run(ctx, { name, configurationId, inputs, copyFrom }) {
    await checkLineup(ctx, configurationId);
    const artistId = await callerArtistId(ctx);
    return run(ctx, async (w) => {
      const base = copyFrom
        ? cloneContent(await loadPlot(w, ctx, copyFrom))
        : { stage: { ...DEFAULT_STAGE }, ...setInputCount({ inputs: [] }, inputs ?? 8), items: [], monitors: [] };
      const r = await w.create("stagePlots", { ...(artistId ? { artistId } : {}), name, ...(configurationId ? { configurationId } : {}), ...base, version: 1 });
      return { id: r.id, version: 1, summary: summary(base as PlotShape).text };
    });
  },
});

export const stagePlotsCopy = defineCommand({
  name: "stagePlots.copy",
  roles: ["admin", "mcp"],
  description:
    "Copy a plot under a new name (default \"<name> copy\"), version 1, with the link off. dropMusicianIds removes those musicians' inputs, mixes and gear from the copy and the channels renumber " +
    "(\"make a no-drums version\": drop the drummer's musicianId from people.list, and name it \"<name> no drums\"). Positions of what stays are kept. Optionally set the copy's lineup with configurationId. Returns {id, version, summary}.",
  input: z.strictObject({ id, name: z.string().min(1).optional(), configurationId: id.optional(), dropMusicianIds: z.array(id).optional() }),
  async run(ctx, { id: from, name, configurationId, dropMusicianIds }) {
    await checkLineup(ctx, configurationId);
    return run(ctx, async (w) => {
      const src = await loadPlot(w, ctx, from);
      await checkMusicians(w, dropMusicianIds ?? []);
      const body = cloneContent(src, dropMusicianIds);
      const cfg = configurationId ?? src.configurationId;
      const r = await w.create("stagePlots", {
        ...(src.artistId ? { artistId: src.artistId } : {}), name: name ?? `${src.name} copy`, ...(cfg ? { configurationId: cfg } : {}), ...body, version: 1,
      });
      return { id: r.id, version: 1, summary: summary(body as PlotShape).text };
    });
  },
});

export const stagePlotsRename = defineCommand({
  name: "stagePlots.rename",
  roles: ["admin", "mcp"],
  description: "Rename a stage plot, or set/clear the lineup it is for (configurationId; null clears). Does not change its version.",
  input: z.strictObject({ id, name: z.string().min(1).optional(), configurationId: id.nullable().optional() }),
  async run(ctx, { id: pid, name, configurationId }) {
    if (configurationId) await checkLineup(ctx, configurationId);
    return run(ctx, async (w) => {
      const p = await loadPlot(w, ctx, pid);
      const patch: Record<string, unknown> = {};
      if (name) patch.name = name.trim();
      if (configurationId === null) { await w.update("stagePlots", pid, { configurationId: null, ...patch }); return { id: pid, changed: true, version: p.version as number }; }
      if (configurationId) patch.configurationId = configurationId;
      return save(w, p, patch, false);
    });
  },
});

export const stagePlotsRemove = defineCommand({
  name: "stagePlots.remove",
  roles: ["admin"],
  description: "Archive a stage plot (undoable). Shows that picked it are cleared, and its engineer link stops working.",
  input: idInput,
  run: (ctx, { id: pid }) => run(ctx, async (w) => {
    await loadPlot(w, ctx, pid);
    const shows = await w.query("shows", (q) => q.where("stagePlotId", "==", pid));
    for (const s of shows) await w.update("shows", s.id, { stagePlotId: null });
    await w.softDelete("stagePlots", pid);
    await deleteToken(pid);
    return { id: pid, changed: true, clearedShows: shows.length };
  }),
});

// ---------- inputs and mixes ----------

export const stagePlotsSetInputCount = defineCommand({
  name: "stagePlots.setInputCount",
  roles: ["admin", "mcp"],
  description:
    "Set how many input channels the plot has (0-64). Raising adds empty, unplaced inputs at the end (their circles wait in the strip). Lowering removes the highest-numbered inputs, " +
    "placed or not, so tell the person if any had a name or a spot (the result lists them in `dropped`). Bumps the plot's version when the count changes.",
  input: z.strictObject({ id, count: z.number().int().min(0).max(MAX_INPUTS) }),
  run: (ctx, { id: pid, count }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    const dropped = dropsWork(shapeOf(p), count).map((i) => ({ n: (p.inputs as StagePlotInput[]).indexOf(i) + 1, source: i.source ?? null }));
    const r = await save(w, p, { inputs: setInputCount({ inputs: p.inputs }, count).inputs }, true);
    return { ...r, inputs: count, dropped };
  }),
});

export const stagePlotsSetMixCount = defineCommand({
  name: "stagePlots.setMixCount",
  roles: ["admin", "mcp"],
  description:
    "Set how many monitor mixes the plot has (0-24), M1..Mn. Raising adds unplaced mixes of `kind` (wedge, iem or sidefill; default wedge); lowering removes the highest-numbered. " +
    "Bumps the plot's version when the count changes.",
  input: z.strictObject({ id, count: z.number().int().min(0).max(MAX_MIXES), kind: monitorKind.optional() }),
  run: (ctx, { id: pid, count, kind }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    const r = await save(w, p, { monitors: setMixCount({ monitors: p.monitors }, count, kind ?? "wedge").monitors }, true);
    return { ...r, mixes: count };
  }),
});

const InputRow = z.strictObject({ n: z.number().int().min(1).optional(), id: id.optional(), ...inputFields })
  .refine((r) => (r.n === undefined) !== (r.id === undefined), "Give exactly one of n (channel number) or id");

export const stagePlotsUpdateInputs = defineCommand({
  name: "stagePlots.updateInputs",
  roles: ["admin", "mcp"],
  description:
    "Fill in input rows in one write: [{n: channel number (or id), source, gear (mic or DI), stand, phantom (48V), musicianId, note}]. null clears a field; fields left out stay. " +
    "\"1 kick, 2 snare, 3 bass DI\" is one call. n must already exist (raise the count with stagePlots.setInputCount first). Does not move circles. " +
    "To change \"Jeff's keys\" or \"Eric's kick\": read stagePlots.get, find the row by musicianId or source, then set `gear` (\"stereo DI\", \"his own kick mic\") on that n. Look up musicianId with people.list. Bumps the version when anything changes.",
  input: z.strictObject({ id, inputs: z.array(InputRow).min(1) }),
  run: (ctx, { id: pid, inputs }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    await checkMusicians(w, inputs.map((r) => r.musicianId));
    const rows = [...(p.inputs as StagePlotInput[])];
    for (const r of inputs) {
      const i = r.n !== undefined ? r.n - 1 : rows.findIndex((x) => x.id === r.id);
      if (i < 0 || i >= rows.length) throw new AppError("not_found", r.n !== undefined ? `Input ${r.n} does not exist: the plot has ${rows.length}` : `Input ${r.id} not found`, 404);
      const { n: _n, id: _id, ...fields } = r;
      rows[i] = patchRow(rows[i], fields);
    }
    return save(w, p, { inputs: rows }, true);
  }),
});

export const stagePlotsReorderInputs = defineCommand({
  name: "stagePlots.reorderInputs",
  roles: ["admin", "mcp"],
  description:
    "Give the inputs a new channel order: `order` lists every input id exactly once (see stagePlots.get). Each circle keeps its spot and takes its new number. Bumps the version.",
  input: z.strictObject({ id, order: z.array(id).min(1) }),
  run: (ctx, { id: pid, order }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    let next;
    try { next = reorderInputs({ inputs: p.inputs }, order); } catch (e) { throw new AppError("invalid_input", (e as Error).message, 400); }
    return save(w, p, { inputs: next.inputs }, true);
  }),
});

// ---------- placing and gear ----------

const MoveRow = z.strictObject({ id, x: z.number().finite().nullable(), y: z.number().finite().optional(), rot: z.number().finite().optional() });

export const stagePlotsMove = defineCommand({
  name: "stagePlots.move",
  roles: ["admin", "mcp"],
  description:
    "Place or move things on the stage in ONE write (a drag, a group drag, or \"put 1-4 on the drum riser\"): [{id, x, y, rot?}] for input circles, mix markers and gear together. " +
    "Feet: x from the stage-right edge (the left of the drawing), y from the upstage edge (the top; the audience is at the bottom). Positions are pulled inside the stage. " +
    "Stage left is the RIGHT side of the drawing (large x); stage right is the left (small x). \"Move Emma to stage left\": stagePlots.get, take every input, mix and gear with her musicianId, move them together. " +
    "x: null sends an input or mix back to the unplaced strip (gear cannot: use stagePlots.removeItems). rot is degrees, for gear. Never changes the version.",
  input: z.strictObject({ id, moves: z.array(MoveRow).min(1) }),
  run: (ctx, { id: pid, moves }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    let next: PlotShape;
    try { next = applyMoves(shapeOf(p), moves as Move[]); } catch (e) { throw new AppError("invalid_input", (e as Error).message, 400); }
    return save(w, p, { inputs: next.inputs, items: next.items, monitors: next.monitors }, false);
  }),
});

const ItemIn = z.strictObject({ type: z.enum(ICON_TYPES), x: z.number().finite(), y: z.number().finite(), rot: z.number().finite().default(0), musicianId: id.optional(), label: z.string().optional() });

export const stagePlotsAddItems = defineCommand({
  name: "stagePlots.addItems",
  roles: ["admin", "mcp"],
  description:
    `Add gear icons for context (an amp, a kit, a riser...): [{type, x, y, rot?, musicianId?, label?}]. type is one of ${ICON_TYPES.join(", ")}. Feet from the stage-right edge (x) and the upstage edge (y). ` +
    "Gear does not add inputs: inputs are circles, set with stagePlots.setInputCount. Never changes the version. Returns the new ids.",
  input: z.strictObject({ id, items: z.array(ItemIn).min(1) }),
  run: (ctx, { id: pid, items }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    await checkMusicians(w, items.map((i) => i.musicianId));
    const added = items.map((i) => ({ ...i, id: newId("g") }));
    const next = clampToStage({ ...shapeOf(p), items: [...(p.items as StagePlotItem[]), ...added] });
    const r = await save(w, p, { items: next.items }, false);
    return { ...r, ids: added.map((a) => a.id) };
  }),
});

export const stagePlotsRemoveItems = defineCommand({
  name: "stagePlots.removeItems",
  roles: ["admin", "mcp"],
  description: "Remove gear icons by id. Inputs and mixes are not gear: use setInputCount / setMixCount. Never changes the version.",
  input: z.strictObject({ id, ids: z.array(id).min(1) }),
  run: (ctx, { id: pid, ids }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    const have = new Set((p.items as StagePlotItem[]).map((i) => i.id));
    const missing = ids.filter((x) => !have.has(x));
    if (missing.length) throw new AppError("not_found", `No gear with id ${missing.join(", ")}`, 404);
    return save(w, p, { items: (p.items as StagePlotItem[]).filter((i) => !ids.includes(i.id)) }, false);
  }),
});

const MonitorRow = z.strictObject({
  n: z.number().int().min(1).optional(), id: id.optional(), kind: monitorKind.optional(), musicianId: nullableStr, wants: nullableStr,
}).refine((r) => (r.n === undefined) !== (r.id === undefined), "Give exactly one of n (mix number) or id");

export const stagePlotsSetMonitors = defineCommand({
  name: "stagePlots.setMonitors",
  roles: ["admin", "mcp"],
  description:
    "Fill in monitor mix rows: [{n: mix number (or id), kind: wedge|iem|sidefill, musicianId (who), wants (\"Bass, keys, vox\")}]. null clears musicianId or wants; fields left out stay. " +
    "The mix must exist (stagePlots.setMixCount). \"Jeff is on in-ears\" = a mix with kind: iem and Jeff's musicianId: reuse his mix from stagePlots.get if he has one, else raise the count with kind: iem, then set it here. Does not move markers. Bumps the version when anything changes.",
  input: z.strictObject({ id, monitors: z.array(MonitorRow).min(1) }),
  run: (ctx, { id: pid, monitors }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    await checkMusicians(w, monitors.map((r) => r.musicianId));
    const rows = [...(p.monitors as StagePlotMonitor[])];
    for (const r of monitors) {
      const i = r.n !== undefined ? r.n - 1 : rows.findIndex((x) => x.id === r.id);
      if (i < 0 || i >= rows.length) throw new AppError("not_found", r.n !== undefined ? `Mix ${r.n} does not exist: the plot has ${rows.length}` : `Mix ${r.id} not found`, 404);
      const { n: _n, id: _id, ...fields } = r;
      rows[i] = patchRow(rows[i], fields);
    }
    return save(w, p, { monitors: rows }, true);
  }),
});

export const stagePlotsSetStage = defineCommand({
  name: "stagePlots.setStage",
  roles: ["admin", "mcp"],
  description:
    "Set the stage size in feet (common: 16x12, 20x14, 24x16, 28x18). Anything now off the stage is pulled back onto it (inputs keep their numbers). Bumps the version when the size changes.",
  input: z.strictObject({ id, widthFt: stageIn.shape.widthFt, depthFt: stageIn.shape.depthFt }),
  run: (ctx, { id: pid, widthFt, depthFt }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    if (p.stage.widthFt === widthFt && p.stage.depthFt === depthFt) return { id: pid, changed: false, version: p.version as number };
    const next = clampToStage({ ...shapeOf(p), stage: { widthFt, depthFt } });
    return save(w, p, { stage: next.stage, inputs: next.inputs, items: next.items, monitors: next.monitors }, true);
  }),
});

export const stagePlotsSetBringNeed = defineCommand({
  name: "stagePlots.setBringNeed",
  roles: ["admin", "mcp"],
  description: "Set the \"We bring\" and \"We need\" text on the sheet (what the band carries; what the venue must have). null or \"\" clears one; leave one out to keep it. Bumps the version when the text changes.",
  input: z.strictObject({ id, bring: nullableStr, need: nullableStr }),
  run: (ctx, { id: pid, bring, need }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of [["bring", bring], ["need", need]] as const) {
      if (v === undefined) continue;
      const t = v?.trim();
      if (t) patch[k] = t; else if (p[k] !== undefined) patch[k] = null;
    }
    // null removes the field (Writer.update), so compare after applying it
    const changed = Object.entries(patch).some(([k, v]) => (v === null ? p[k] !== undefined : p[k] !== v));
    if (!changed) return { id: pid, changed: false, version: p.version as number };
    const version = (p.version as number) + 1;
    await w.update("stagePlots", pid, { ...patch, version });
    return { id: pid, changed: true, version };
  }),
});

// ---------- the show's plot ----------

export const showsSetStagePlot = defineCommand({
  name: "shows.setStagePlot",
  roles: ["admin", "mcp"],
  description: "Pick the stage plot a show uses (stagePlotId), or clear it (null). This show only. \"Use the no-drums plot for the Roots show\": find the show with search, the plot with stagePlots.list, then call this. Always picked by hand: there is no lineup default. Plots made for the show's lineup (billedAs) are the usual choice.",
  input: z.strictObject({ showId: id, stagePlotId: id.nullable() }),
  run: (ctx, { showId, stagePlotId }) => run(ctx, async (w) => {
    const show = await w.get("shows", showId);
    if (!show || show.deletedAt || (ctx.artistId && show.artistId && show.artistId !== ctx.artistId)) throw new AppError("not_found", `Show ${showId} not found`, 404);
    if (stagePlotId) await loadPlot(w, ctx, stagePlotId);
    return w.update("shows", showId, { stagePlotId });
  }),
});

// ---------- reads ----------

export const stagePlotsList = defineCommand({
  name: "stagePlots.list",
  roles: ["admin", "member", "mcp"],
  description: "List the band's stage plots: id, name, lineup (configurationId), version, stage size, whether the engineer link is on, and `summary` (counts plus text like \"11 inputs, 3 mixes, 3 power drops\"). Optionally only one lineup. Use it to find a plot by name or lineup (\"the duo\", \"the trio\"). \"How many inputs is the trio?\": list that lineup and answer from summary.inputs.",
  input: z.strictObject({ configurationId: id.optional() }),
  async run(ctx, { configurationId }) {
    const artistId = await callerArtistId(ctx);
    const all = await db.list("stagePlots", artistId ? (q) => q.where("artistId", "==", artistId) : undefined);
    const rows = all.filter((p) => !configurationId || p.configurationId === configurationId).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return {
      count: rows.length,
      plots: rows.map((p) => ({
        id: p.id, name: p.name, configurationId: p.configurationId ?? null, version: p.version, stage: p.stage, shared: !!p.share?.on, ...withText(p),
      })),
    };
  },
});

export const stagePlotsGet = defineCommand({
  name: "stagePlots.get",
  roles: ["admin", "member", "mcp"],
  description:
    "One stage plot in full: stage, inputs (in channel order, with ids), gear, mixes, bring/need, version, plus `summary` ({inputs, placed, unplaced, mixes, powerDrops, text: \"11 inputs, 3 mixes, 3 power drops\"}) and `notPlaced` (the channel numbers not on the stage yet). " +
    "x/y are feet from the stage-right edge and the upstage edge. Use it to answer \"how many inputs is the trio?\" and to find a person's rows (musicianId) before editing.",
  input: idInput,
  async run(ctx, { id: pid }) {
    const p = await db.get("stagePlots", pid);
    if (!p || p.deletedAt || (ctx.artistId && p.artistId && p.artistId !== ctx.artistId)) throw new AppError("not_found", `Stage plot ${pid} not found`, 404);
    return { ...present(p), ...withText(p) };
  },
});

export const stagePlotsStaleShows = defineCommand({
  name: "stagePlots.staleShows",
  roles: ["admin", "member", "mcp"],
  description:
    "\"Who still needs the new plot?\" Upcoming shows (hold or confirmed, today on) whose stage plot needs attention. V1 does not track which version each venue got, so this is a proxy: " +
    "noPlot = billed as a lineup that has a stage plot but no plot picked; wrongLineup = the picked plot is for a different lineup while one exists for the billed lineup; " +
    "missingPlot = the picked plot was archived. Each row gives the show, why, and the plot to pick (suggestPlotId) with its current version.",
  input: z.strictObject({}),
  async run(ctx) {
    const artistId = await callerArtistId(ctx);
    const [plots, shows] = await Promise.all([
      db.list("stagePlots", artistId ? (q) => q.where("artistId", "==", artistId) : undefined),
      db.list("shows", artistId ? (q) => q.where("artistId", "==", artistId) : undefined),
    ]);
    const today = todayStr(ctx.now);
    const byId = new Map(plots.map((p) => [p.id, p]));
    const forLineup = (cfg: string) => plots.filter((p) => p.configurationId === cfg).sort((a, b) => String(a.name).localeCompare(String(b.name)))[0];
    const rows: Record<string, unknown>[] = [];
    for (const s of shows.filter((x) => x.date >= today && (x.status === "hold" || x.status === "confirmed")).sort((a, b) => a.date.localeCompare(b.date))) {
      const cur = s.stagePlotId ? byId.get(s.stagePlotId) : undefined;
      const want = s.billedAs ? forLineup(s.billedAs) : undefined;
      let reason: string | undefined;
      if (s.stagePlotId && !cur) reason = "missingPlot";
      else if (!s.stagePlotId && want) reason = "noPlot";
      else if (cur && want && cur.configurationId !== s.billedAs) reason = "wrongLineup";
      if (!reason) continue;
      rows.push({
        showId: s.id, name: showName(s as never), date: s.date, billedAs: s.billedAs ?? null, reason,
        currentPlot: cur ? { id: cur.id, name: cur.name, version: cur.version } : null,
        suggestPlotId: want?.id ?? null, suggestPlotName: want?.name ?? null, suggestVersion: want?.version ?? null,
      });
    }
    return { today, count: rows.length, shows: rows };
  },
});

// ---------- engineer link ----------

export const stagePlotsShareLink = defineCommand({
  name: "stagePlots.shareLink",
  roles: ["admin", "mcp"],
  description:
    "Turn on the public engineer link for a plot (/plot/{id}/{token}, no login, always shows the latest version) and return its url. There is one stable link per plot: asking again while it is on returns the same url. " +
    "Pass rotate: true to make a new link (the old one stops working). stagePlots.shareOff turns it off; turning it on again makes a new token.",
  input: z.strictObject({ id, rotate: z.boolean().optional() }),
  run: (ctx, { id: pid, rotate }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    if (p.share?.on && !rotate) {
      const kept = await readToken(pid);
      if (kept) return { id: pid, on: true, alreadyOn: true, url: plotLink(pid, kept) };
    }
    const token = newToken();
    await saveToken(pid, token);
    await w.update("stagePlots", pid, { share: { on: true, tokenHash: hashToken(token), at: (ctx.now ?? new Date()).toISOString() } });
    return { id: pid, on: true, alreadyOn: false, url: plotLink(pid, token) };
  }),
});

export const stagePlotsShareOff = defineCommand({
  name: "stagePlots.shareOff",
  roles: ["admin", "mcp"],
  description: "Turn the engineer link off: the old link stops working at once. Turning it on again (stagePlots.shareLink) makes a new link.",
  input: idInput,
  run: (ctx, { id: pid }) => run(ctx, async (w) => {
    const p = await loadPlot(w, ctx, pid);
    if (!p.share?.on) return { id: pid, on: false, changed: false };
    await w.update("stagePlots", pid, { share: { on: false } });
    await deleteToken(pid);
    return { id: pid, on: false, changed: true };
  }),
});

export const stagePlotsEngineerLink = defineCommand({
  name: "stagePlots.engineerLink",
  roles: ["admin", "member", "mcp"],
  description: "The engineer link for a plot, to copy: {on, url}. url is null when the link is off. Read only; admins turn it on and off with stagePlots.shareLink / shareOff.",
  input: idInput,
  async run(ctx, { id: pid }) {
    const p = await db.get("stagePlots", pid);
    if (!p || p.deletedAt || (ctx.artistId && p.artistId && p.artistId !== ctx.artistId)) throw new AppError("not_found", `Stage plot ${pid} not found`, 404);
    const token = p.share?.on ? await readToken(pid) : null;
    return { id: pid, on: !!token, url: token ? plotLink(pid, token) : null };
  },
});

export const stagePlotCommands = [
  stagePlotsCreate, stagePlotsCopy, stagePlotsRename, stagePlotsRemove, stagePlotsSetInputCount, stagePlotsSetMixCount, stagePlotsUpdateInputs,
  stagePlotsReorderInputs, stagePlotsMove, stagePlotsAddItems, stagePlotsRemoveItems, stagePlotsSetMonitors, stagePlotsSetStage, stagePlotsSetBringNeed,
  showsSetStagePlot, stagePlotsList, stagePlotsGet, stagePlotsStaleShows, stagePlotsShareLink, stagePlotsShareOff, stagePlotsEngineerLink,
];
