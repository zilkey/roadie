import { z } from "zod";
import { defineCommand } from "./types";
import { run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { artistFor } from "./projects";

// Booking campaigns (#82): a campaign is a tag on pitches, like a tour (pitches.campaignId). Every pitch is in one campaign;
// "Ongoing" is the virtual default, computed in memory: active pitches with no campaignId or whose campaign is closed.
// Closing only sets status (pitches keep campaignId, so a closed campaign keeps its history) and campaigns.reopen undoes it.
// Admins only, and not MCP. Kept out of Roadie (assistant/policy.ts EXCLUDED) until the campaign pages ship.

const ROLES = ["admin"] as const;
const id1 = z.string().min(1);
const name = z.string().trim().min(1);

/** The caller's artist id: the ctx's, else the one artist (artistFor). */
async function artistIdOf(w: Writer): Promise<string> {
  return w.ctx.artistId ?? ((await artistFor(w)).id as string);
}

async function requireCampaign(w: Writer, id: string, artistId: string): Promise<Doc> {
  const c = await w.get("campaigns", id);
  if (!c || c.deletedAt || c.artistId !== artistId) throw new AppError("not_found", "Campaign not found", 404);
  return c;
}

/** A live campaign of this artist that is still active: what a pitch may be put in. */
export async function requireActiveCampaign(w: Writer, id: string, artistId: string): Promise<Doc> {
  const c = await requireCampaign(w, id, artistId);
  if (c.status !== "active") throw new AppError("invalid_state", `${c.name} is closed. Reopen it first.`, 409);
  return c;
}

/** Names are unique per artist (any status, ignoring case), so "Spring 2027" means one thing on the page and to Roadie later. */
async function refuseDuplicateName(w: Writer, artistId: string, n: string, except?: string) {
  const all = await w.query("campaigns", (q) => q.where("artistId", "==", artistId), { pending: true });
  const clash = all.find((c) => !c.deletedAt && c.id !== except && String(c.name).toLowerCase() === n.toLowerCase());
  if (clash) throw new AppError("conflict", `There is already a campaign called ${clash.name}`, 409);
}

export const campaignsCreate = defineCommand({
  name: "campaigns.create", roles: [...ROLES], description: "Start a booking campaign: name. It starts active. Returns { id }.",
  input: z.strictObject({ name }),
  run: (ctx, i) => run(ctx, async (w) => {
    const artistId = await artistIdOf(w);
    await refuseDuplicateName(w, artistId, i.name);
    return w.create("campaigns", { artistId, name: i.name, status: "active" });
  }),
});

export const campaignsRename = defineCommand({
  name: "campaigns.rename", roles: [...ROLES], description: "Rename a booking campaign.",
  input: z.strictObject({ id: id1, name }),
  run: (ctx, i) => run(ctx, async (w) => {
    const artistId = await artistIdOf(w);
    const c = await requireCampaign(w, i.id, artistId);
    if (c.name === i.name) return { id: i.id, changed: false };
    await refuseDuplicateName(w, artistId, i.name, i.id);
    await w.update("campaigns", i.id, { name: i.name });
    return { id: i.id, changed: true };
  }),
});

/** close / reopen: status only. Pitches keep their campaignId either way. */
const setStatus = (status: "active" | "closed") => (ctx: Parameters<typeof run>[0], i: { id: string }) => run(ctx, async (w) => {
  const c = await requireCampaign(w, i.id, await artistIdOf(w));
  if (c.status === status) return { id: i.id, changed: false };
  await w.update("campaigns", i.id, { status });
  return { id: i.id, changed: true };
});

export const campaignsClose = defineCommand({
  name: "campaigns.close", roles: [...ROLES],
  description: "Close a booking campaign. Only its status changes: its pitches stay in it (the closed campaign keeps its history), and its active pitches show under Ongoing. campaigns.reopen undoes it.",
  input: z.strictObject({ id: id1 }),
  run: setStatus("closed"),
});

export const campaignsReopen = defineCommand({
  name: "campaigns.reopen", roles: [...ROLES], description: "Reopen a closed booking campaign.",
  input: z.strictObject({ id: id1 }),
  run: setStatus("active"),
});

export const pitchesSetCampaign = defineCommand({
  name: "pitches.setCampaign", roles: [...ROLES],
  description: "Put pitches in a booking campaign: ids (pitch ids), campaignId (an active campaign; null takes them out, back to Ongoing).",
  input: z.strictObject({ ids: z.array(id1).min(1), campaignId: id1.nullable() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const artistId = await artistIdOf(w);
    if (i.campaignId) await requireActiveCampaign(w, i.campaignId, artistId);
    const changed: string[] = [];
    for (const id of [...new Set(i.ids)]) {
      const p = await w.get("pitches", id);
      if (!p || p.deletedAt || p.artistId !== artistId) throw new AppError("not_found", "Pitch not found", 404);
      if ((p.campaignId ?? null) === i.campaignId) continue;
      await w.update("pitches", id, { campaignId: i.campaignId });
      changed.push(id);
    }
    return { ids: changed };
  }),
});

export const campaignCommands = [campaignsCreate, campaignsRename, campaignsClose, campaignsReopen, pitchesSetCampaign];
