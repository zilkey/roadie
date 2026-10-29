import { z } from "zod";
import { run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { projectKind, cents } from "@/schema";

/** The artist a call is for: the one given, else the one this call is for (ctx.artistId), else the one artist there is. */
export async function artistFor(w: Writer, artistId = w.ctx.artistId): Promise<Doc> {
  const a = artistId ? await w.get("artists", artistId) : (await w.query("artists", (q) => q.limit(1)))[0];
  if (!a || a.deletedAt) throw new AppError("not_found", "Set up the artist first", 404);
  return a;
}

/** The name every artist's starting project gets: the catch-all bucket money lands on until there is a better one. */
export const DEFAULT_PROJECT_NAME = "General";

/** The artist's default project (General), if it has one. */
export async function defaultProjectOf(w: Writer, artistId: string): Promise<Doc | undefined> {
  return (await w.query("projects", (q) => q.where("artistId", "==", artistId), { pending: true })).find((p) => p.isDefault && !p.deletedAt);
}
/**
 * The artist's default project. artists.create / artists.signUp make "General" with the artist, so Money in and
 * Money out can save from the first day; a band that predates projects gets it the first time money or a show needs
 * somewhere to land, so nothing refuses to save before `npm run migrate:money`.
 */
export async function ensureDefaultProject(w: Writer, artistId: string): Promise<Doc> {
  const cur = await defaultProjectOf(w, artistId);
  if (cur) return cur;
  const r = await w.create("projects", { artistId, kind: "band", name: DEFAULT_PROJECT_NAME, status: "open", isDefault: true });
  return (await w.get("projects", r.id))!;
}

/** The project new money lands on: the billed-as configuration's defaultProjectId when it names one, else the artist's default project. Makes the General project when the artist has no default yet. */
export async function defaultProjectIdFor(w: Writer, artistId: string, billedAs?: string | null): Promise<string | undefined> {
  if (billedAs) {
    const artist = await w.get("artists", artistId);
    const cfg = (artist?.configurations as { id: string; defaultProjectId?: string }[] | undefined)?.find((c) => c.id === billedAs);
    if (cfg?.defaultProjectId) return cfg.defaultProjectId;
  }
  return (await ensureDefaultProject(w, artistId)).id;
}

/** The project, or not_found (missing/deleted) / invalid_state 409 (closed: nothing new lands on it). */
export async function requireOpenProject(w: Writer, projectId: string): Promise<Doc> {
  const p = await w.get("projects", projectId);
  if (!p || p.deletedAt) throw new AppError("not_found", "Project not found", 404);
  if (p.status === "closed") throw new AppError("invalid_state", `${p.name} is closed`, 409);
  return p;
}

async function requireProject(w: Writer, id: string) {
  const p = await w.get("projects", id);
  if (!p || p.deletedAt) throw new AppError("not_found", "Project not found", 404);
  if (w.ctx.artistId && p.artistId !== w.ctx.artistId) throw new AppError("not_found", "Project not found", 404);
  return p;
}
/** Exactly one default per artist: clear the flag on every other project that has it. */
async function clearOtherDefaults(w: Writer, artistId: string, keepId?: string) {
  for (const p of await w.query("projects", (q) => q.where("artistId", "==", artistId))) {
    if (p.isDefault && p.id !== keepId && !p.deletedAt) await w.update("projects", p.id, { isDefault: null });
  }
}

export const projectsCreate = defineCommand({
  name: "projects.create", roles: ["admin"],
  description: "Create a project, a bucket every income, expense and payout belongs to (Band is the default one; others are a duo, a release, a tour, a music video). " +
    "kind: band|duo|release|tour|video|other, name. isDefault:true makes it THE default (the old one stops being it): money with no project lands there. Returns { id }.",
  input: z.strictObject({
    kind: projectKind, name: z.string().trim().min(1), isDefault: z.boolean().optional(),
  }),
  run: (ctx, i) => run(ctx, async (w) => {
    const artist = await artistFor(w);
    if (i.isDefault) await clearOtherDefaults(w, artist.id);
    return w.create("projects", { ...i, artistId: artist.id, status: "open" });
  }),
});

export const projectsUpdate = defineCommand({
  name: "projects.update", roles: ["admin"],
  description: "Edit a project (id from context.now projects): name, kind, isDefault (true only: it becomes THE default and the old default stops being it).",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({
    name: z.string().trim().min(1).optional(), kind: projectKind.optional(),
    isDefault: z.boolean().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const p = await requireProject(w, id);
    // A plain boolean, not z.literal(true): Gemini only takes string enums, and a literal becomes enum [true] (prod refused every tool, 2026-10-29).
    if (patch.isDefault === false) throw new AppError("invalid_input", "Make another project the default instead", 400);
    if (patch.isDefault) await clearOtherDefaults(w, p.artistId as string, id);
    return w.update("projects", id, patch as Record<string, unknown>);
  }),
});

export const projectsClose = defineCommand({
  name: "projects.close", roles: ["admin"], input: idInput,
  description: "Close a project: it stays readable but nothing new can be added to it. A project with money on it is closed, never removed (an empty one can be removed with projects.remove).",
  run: (ctx, { id }) => run(ctx, async (w) => { await requireProject(w, id); return w.update("projects", id, { status: "closed" }); }),
});

export const projectsReopen = defineCommand({
  name: "projects.reopen", roles: ["admin"], input: idInput,
  description: "Reopen a closed project so money can land on it again.",
  run: (ctx, { id }) => run(ctx, async (w) => { await requireProject(w, id); return w.update("projects", id, { status: "open" }); }),
});

/** What still points at a project: live money, shows billed to it, releases made with it and rehearsals on it. Any of these keeps it from being removed. */
export async function projectInUse(w: Writer, id: string): Promise<string[]> {
  const live = async (coll: string) => (await w.query(coll, (q) => q.where("projectId", "==", id))).filter((d) => !d.deletedAt).length;
  const [inc, exp, pay, shows, rels, rehs] = await Promise.all(["income", "expenses", "payouts", "shows", "releases", "rehearsals"].map(live));
  const reasons: string[] = [];
  if (inc + exp + pay) reasons.push(`${inc + exp + pay} money record${inc + exp + pay === 1 ? "" : "s"}`);
  if (shows) reasons.push(`${shows} show${shows === 1 ? "" : "s"}`);
  if (rels) reasons.push(`${rels} release${rels === 1 ? "" : "s"}`);
  if (rehs) reasons.push(`${rehs} rehearsal${rehs === 1 ? "" : "s"}`);
  return reasons;
}

export const projectsRemove = defineCommand({
  name: "projects.remove", roles: ["admin"], input: idInput,
  description: "Remove a project that has nothing on it: no income, expenses or payouts, no show billed to it, no release. One with money on it is closed instead (projects.close). The default project cannot be removed: make another the default first.",
  run: (ctx, { id }) => run(ctx, async (w) => {
    const p = await requireProject(w, id);
    if (p.isDefault) throw new AppError("invalid_state", "That is the default project: make another project the default first", 409);
    const used = await projectInUse(w, id);
    if (used.length) throw new AppError("invalid_state", `${p.name} has ${used.join(", ")} on it: close it instead`, 409);
    return w.softDelete("projects", id);
  }),
});

export const projectCommands = [projectsCreate, projectsUpdate, projectsClose, projectsReopen, projectsRemove];
