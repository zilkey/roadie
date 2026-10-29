import { z } from "zod";
import { randomUUID } from "node:crypto";
import { defineCommand } from "./types";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { driveClient, type DriveFile, type DriveService } from "../integrations";
import { FOLDER_MIME } from "../integrations/drive";
import { bandFolders, bandmates, inspect, sharingOf, type Bandmate } from "../music";
import { releaseKind, trackStatus, trackCredit, fileKind, dateStr, driveRef } from "@/schema";
import { guessReleaseKind, guessVersion, sidesFor, sortTracks, trackReached } from "@/lib/releases";
import { providerFor } from "@/lib/music";
import { artistFor } from "./projects";
import { chosenFolder } from "./google";

// Releases (#12): a release is a record next to Songs: an ordered tracklist built from songs (releases/{id}/tracks), the files
// that only belong to the record (files docs with releaseId / releaseTrackId: mixes by version, masters, stems, artwork...),
// and its money, which is the project made with it (projectId, kind "release").
// Songs are untouched: charts and demos stay on the song; a track points at its song.

const id1 = z.string().min(1);
export const tracksPath = (releaseId: string) => `releases/${releaseId}/tracks`;
export const RELEASES_FOLDER_NAME = "Releases";
export const NO_BAND_FOLDER = "Choose the band folder on Settings > Google first: the release folder goes inside it";

async function requireRelease(w: Writer, id: string): Promise<Doc> {
  const a = await w.get("releases", id);
  if (!a || a.deletedAt) throw new AppError("not_found", "Release not found", 404);
  if (w.ctx.artistId && a.artistId !== w.ctx.artistId) throw new AppError("not_found", "Release not found", 404);
  return a;
}
/** The release's live tracks in order. `pending` sees tracks this run has just written. */
async function liveTracks(w: Writer, releaseId: string, pending = false): Promise<Doc[]> {
  return sortTracks((await w.query(tracksPath(releaseId), undefined, { pending })) as (Doc & { position: number })[]);
}
async function requireTrack(w: Writer, releaseId: string, id: string): Promise<Doc> {
  const t = await w.get(tracksPath(releaseId), id);
  if (!t || t.deletedAt) throw new AppError("not_found", "Track not found", 404);
  return t;
}
async function liveSong(w: Writer, id: string): Promise<Doc> {
  const s = await w.get("songs", id);
  if (!s || s.deletedAt) throw new AppError("not_found", `Song ${id} not found`, 404);
  return s;
}

/**
 * Money on a track: the track must be on the release whose project the money is on. Used by expenses.add / income.add with
 * releaseTrackId. Returns the track.
 */
export async function requireTrackOnProject(w: Writer, projectId: string | undefined, trackId: string): Promise<Doc> {
  const release = projectId ? (await w.query("releases", (q) => q.where("projectId", "==", projectId)))[0] : undefined;
  if (!release) throw new AppError("invalid_input", "That project has no release, so there is no track to put this on", 400);
  const t = await w.get(tracksPath(release.id), trackId);
  if (!t || t.deletedAt) throw new AppError("not_found", "Track not found on that release", 404);
  return t;
}

/** Write the next tracks onto the release: one per song not already on it, after the last track, on `side` (or the last track's). */
async function appendTracks(w: Writer, releaseId: string, songIds: string[], side?: string) {
  const have = await liveTracks(w, releaseId, true);
  const on = new Set(have.map((t) => t.songId as string));
  const last = have[have.length - 1];
  let position = (last?.position as number | undefined) ?? 0;
  const ids: string[] = [];
  let skipped = 0;
  for (const songId of [...new Set(songIds)]) {
    if (on.has(songId)) { skipped++; continue; }
    const s = await liveSong(w, songId);
    position++;
    const sideOf = side ?? (last?.side as string | undefined);
    const r = await w.create(tracksPath(releaseId), {
      releaseId, position, songId, title: s.title as string, status: "tracking", credits: [],
      ...(sideOf ? { side: sideOf } : {}), ...(s.lengthSec != null ? { lengthSec: s.lengthSec as number } : {}),
    });
    ids.push(r.id);
    on.add(songId);
  }
  return { ids, skipped };
}
/** The songs of a setlist template, in its order (breaks and off-library one-offs are skipped). */
async function setlistSongIds(w: Writer, templateId: string): Promise<string[]> {
  const t = await w.get("setlistTemplates", templateId);
  if (!t || t.deletedAt) throw new AppError("not_found", "Setlist template not found", 404);
  return ((t.items ?? []) as { type: string; songId?: string }[]).filter((i) => i.type === "song" && i.songId).map((i) => i.songId as string);
}
/** Positions 1..n in the given order, and sides carried over by where the breaks were. */
async function renumber(w: Writer, releaseId: string, ordered: Doc[], keepSides = true) {
  const before = sortTracks(ordered as (Doc & { position: number })[]);
  const breaks = keepSides ? before.flatMap((t, i) => (i > 0 && t.side !== before[i - 1].side ? [i] : [])) : [];
  const sides = sidesFor(ordered.length, breaks);
  for (const [i, t] of ordered.entries()) {
    const patch: Record<string, unknown> = {};
    if (t.position !== i + 1) patch.position = i + 1;
    if ((t.side ?? undefined) !== sides[i]) patch.side = sides[i] ?? null;
    if (Object.keys(patch).length) await w.update(tracksPath(releaseId), t.id, patch);
  }
}

// ---------- the release ----------

export const releasesCreate = defineCommand({
  name: "releases.create", roles: ["admin", "mcp"],
  description: "Start a release (an album, EP or single): title, kind (album|ep|single, default album), releaseDate (YYYY-MM-DD, the target; once it has passed the release counts as released). Where a record stands is its tracks' statuses. " +
    "Makes its money project (kind release, same name) at the same time: every expense and income for the record goes on that project. The tracklist starts from setlistId (a setlist template's songs in order) and/or songIds (from search), or empty. " +
    "driveFolderId (a folder id or Drive folder link, anywhere in Drive) is the release's own folder: its files and uploads go there; makeFolder:true makes \"Band folder / Releases / {title}\" instead. Returns { id, projectId, trackIds, folder }.",
  input: z.strictObject({
    title: z.string().trim().min(1), kind: releaseKind.default("album"), releaseDate: dateStr.optional(),
    setlistId: id1.optional(), songIds: z.array(id1).default([]), driveFolderId: z.string().trim().min(1).optional(), makeFolder: z.boolean().default(false),
  }),
  async run(ctx, i) {
    // The chosen folder is checked with Drive before anything is written: a link to a file or a folder Drive can't see is refused.
    const chosen = i.driveFolderId ? await chosenFolder(artistIdOf(ctx), i.driveFolderId) : null;
    const r = await run(ctx, async (w) => {
      const artist = await artistFor(w);
      const project = await w.create("projects", { artistId: artist.id, kind: "release", name: i.title, status: "open" });
      const release = await w.create("releases", {
        artistId: artist.id, title: i.title, kind: i.kind, projectId: project.id, ...(i.releaseDate ? { releaseDate: i.releaseDate } : {}), ...(chosen ? { driveFolderId: chosen.id, driveFolderName: chosen.name } : {}),
      });
      const songIds = [...(i.setlistId ? await setlistSongIds(w, i.setlistId) : []), ...i.songIds];
      const tracks = await appendTracks(w, release.id, songIds);
      return { id: release.id, projectId: project.id, trackIds: tracks.ids };
    });
    // Drive is outside the transaction (run() may retry); a band without a band folder just gets no folder.
    const folder = chosen ? info(chosen) : i.makeFolder ? await ensureReleaseFolder(ctx, r.id).catch((e) => { if (e instanceof AppError && e.code === "no_band_folder") return null; throw e; }) : null;
    return { ...r, folder };
  },
});

export const releasesUpdate = defineCommand({
  name: "releases.update", roles: ["admin", "mcp"],
  description: "Edit a release (id from search): title (renames its project too), kind, releaseDate / cover (a Drive file: { driveFileId, url }) / distributor / upc / formats (null clears).",
  input: z.strictObject({ id: id1, patch: z.strictObject({
    title: z.string().trim().min(1).optional(), kind: releaseKind.optional(), releaseDate: dateStr.nullable().optional(), cover: driveRef.nullable().optional(), distributor: z.string().trim().nullable().optional(),
    upc: z.string().trim().nullable().optional(), formats: z.string().trim().nullable().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const a = await requireRelease(w, id);
    const p: Record<string, unknown> = { ...patch };
    for (const k of ["distributor", "upc", "formats"] as const) if (p[k] === "") p[k] = null;
    if (patch.title && patch.title !== a.title) {
      const project = await w.get("projects", a.projectId as string);
      if (project && !project.deletedAt) await w.update("projects", project.id, { name: patch.title });
    }
    return w.update("releases", id, p);
  }),
});

export const releasesRemove = defineCommand({
  name: "releases.remove", roles: ["admin"],
  description: "Archive a release with its tracks and release-only files; its project is closed (never removed) so the money stays readable.",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => run(ctx, async (w) => {
    const a = await requireRelease(w, id);
    for (const t of await liveTracks(w, id)) await w.softDelete(tracksPath(id), t.id);
    for (const f of await w.query("files", (q) => q.where("releaseId", "==", id))) await w.softDelete("files", f.id);
    const project = await w.get("projects", a.projectId as string);
    if (project && !project.deletedAt && project.status !== "closed") await w.update("projects", project.id, { status: "closed" });
    return w.softDelete("releases", id);
  }),
});

// ---------- tracks ----------

export const releaseTracksAdd = defineCommand({
  name: "releases.tracks.add", roles: ["admin", "mcp"],
  description: "Put songs on a release, after its last track: songIds (from search, in the order given) and/or setlistId (a setlist template: its songs in its order; breaks are skipped). " +
    "A song already on the release is skipped. side (\"A\", \"B\") puts them on that side; otherwise they take the last track's. Title and length start from the song. Returns { ids, skipped }.",
  input: z.strictObject({ releaseId: id1, songIds: z.array(id1).default([]), setlistId: id1.optional(), side: z.string().trim().min(1).max(2).optional() })
    .refine((v) => v.songIds.length || v.setlistId, "Give songIds or a setlistId"),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireRelease(w, i.releaseId);
    const songIds = [...(i.setlistId ? await setlistSongIds(w, i.setlistId) : []), ...i.songIds];
    return appendTracks(w, i.releaseId, songIds, i.side?.toUpperCase());
  }),
});

export const releaseTracksUpdate = defineCommand({
  name: "releases.tracks.update", roles: ["admin", "mcp"],
  description: "Edit one track of a release (releaseId, id from records.get releases / the release page): title (on the release; the song keeps its own), status (tracking|overdubs|mixing|mixed|mastered), isrc / lengthSec (null clears), explicit, credits (the whole list of { who, role }).",
  input: z.strictObject({ releaseId: id1, id: id1, patch: z.strictObject({
    title: z.string().trim().min(1).optional(), status: trackStatus.optional(), isrc: z.string().trim().nullable().optional(), lengthSec: z.number().int().nonnegative().nullable().optional(),
    explicit: z.boolean().optional(), credits: z.array(trackCredit).optional(),
  }) }),
  run: (ctx, { releaseId, id, patch }) => run(ctx, async (w) => {
    await requireRelease(w, releaseId);
    await requireTrack(w, releaseId, id);
    const p: Record<string, unknown> = { ...patch };
    if (p.isrc === "") p.isrc = null;
    return w.update(tracksPath(releaseId), id, p);
  }),
});

export const releaseTracksRemove = defineCommand({
  name: "releases.tracks.remove", roles: ["admin", "mcp"],
  description: "Take a track off a release (its release-only files go with it; the song stays in Songs). The rest renumber.",
  input: z.strictObject({ releaseId: id1, id: id1 }),
  run: (ctx, { releaseId, id }) => run(ctx, async (w) => {
    await requireRelease(w, releaseId);
    await requireTrack(w, releaseId, id);
    for (const f of await w.query("files", (q) => q.where("releaseTrackId", "==", id))) await w.softDelete("files", f.id);
    const r = await w.softDelete(tracksPath(releaseId), id);
    await renumber(w, releaseId, (await liveTracks(w, releaseId)).filter((t) => t.id !== id));
    return r;
  }),
});

export const releaseTracksReorder = defineCommand({
  name: "releases.tracks.reorder", roles: ["admin", "mcp"],
  description: "Set the running order of a release: ids, every track of the release exactly once, in the new order. Side breaks stay where they were (by position).",
  input: z.strictObject({ releaseId: id1, ids: z.array(id1).min(1) }),
  run: (ctx, { releaseId, ids }) => run(ctx, async (w) => {
    await requireRelease(w, releaseId);
    const have = await liveTracks(w, releaseId);
    const byId = new Map(have.map((t) => [t.id, t]));
    if (ids.length !== have.length || new Set(ids).size !== ids.length || ids.some((x) => !byId.has(x))) throw new AppError("invalid_input", "ids must name every track of the release once", 400);
    await renumber(w, releaseId, ids.map((x) => byId.get(x)!));
    return { releaseId, total: ids.length };
  }),
});

export const releaseTracksSideBreak = defineCommand({
  name: "releases.tracks.sideBreak", roles: ["admin", "mcp"],
  description: "Side breaks (vinyl): atTrackId starts a new side at that track (the tracks before are Side A, from there Side B, and so on with more breaks); remove:true takes that break away; atTrackId null clears every side.",
  input: z.strictObject({ releaseId: id1, atTrackId: id1.nullable(), remove: z.boolean().default(false) }),
  run: (ctx, { releaseId, atTrackId, remove }) => run(ctx, async (w) => {
    await requireRelease(w, releaseId);
    const have = await liveTracks(w, releaseId);
    const breaks = new Set(have.flatMap((t, i) => (i > 0 && t.side !== have[i - 1].side ? [i] : [])));
    if (atTrackId) {
      const at = have.findIndex((t) => t.id === atTrackId);
      if (at < 0) throw new AppError("not_found", "Track not found", 404);
      if (at === 0 && !remove) throw new AppError("invalid_input", "The first track can't start a new side", 400);
      if (remove) breaks.delete(at); else breaks.add(at);
    } else breaks.clear();
    const sides = sidesFor(have.length, [...breaks]);
    for (const [i, t] of have.entries()) if ((t.side ?? undefined) !== sides[i]) await w.update(tracksPath(releaseId), t.id, { side: sides[i] ?? null });
    return { releaseId, sides: [...new Set(sides.filter(Boolean))] };
  }),
});

// ---------- files: mixes, masters, stems, artwork... (files docs with releaseId / releaseTrackId) ----------

const AttachDrive = z.strictObject({ driveFileId: id1, kind: fileKind.optional(), title: z.string().optional(), version: z.number().int().positive().optional() });
const AttachLink = z.strictObject({ url: z.string().url(), provider: z.enum(["spotify", "youtube", "web"]).optional(), kind: fileKind.optional(), title: z.string().optional(), version: z.number().int().positive().optional() });
const AttachFile = z.union([AttachDrive, AttachLink]);
type Attach = z.infer<typeof AttachFile>;

/** The folders a release file counts as "in the band folder" under: the band's, plus the release's own. */
async function releaseFolders(artistId: string | undefined, release: Doc) {
  const { all } = await bandFolders(artistId);
  return release.driveFolderId ? [...all, release.driveFolderId as string] : all;
}

/** File docs for the attachments, looked up in Drive (links get no Drive facts). Kind: given, else guessed from the name; version: given, else from the name. */
async function buildReleaseFileDocs(artistId: string | undefined, release: Doc, trackId: string | undefined, files: Attach[]) {
  const [mates, folders] = await Promise.all([bandmates(), releaseFolders(artistId, release)]);
  const drive = driveClient({ artistId });
  const parent = { releaseId: release.id, ...(trackId ? { releaseTrackId: trackId } : {}) };
  const out: Record<string, unknown>[] = [];
  for (const a of files) {
    if (!("driveFileId" in a)) {
      const p = a.provider ?? providerFor(a.url);
      if (p === "drive") throw new AppError("invalid_input", "Attach Drive files by driveFileId, not url", 400);
      const title = a.title?.trim() || a.url;
      const version = a.version ?? guessVersion(title);
      out.push({ kind: a.kind ?? guessReleaseKind(title, undefined, !!trackId), title, ...parent, provider: p, url: a.url, ...(version ? { version } : {}), checkedAt: new Date() });
      continue;
    }
    let f: DriveFile;
    try { f = await drive.get(a.driveFileId); } catch { throw new AppError("not_found", `Drive file ${a.driveFileId} not found`, 404); }
    const ins = await inspect(f, mates, folders, drive);
    const title = a.title?.trim() || f.name;
    const version = a.version ?? guessVersion(f.name);
    out.push({
      kind: a.kind ?? guessReleaseKind(f.name, f.mimeType, !!trackId), title, ...parent, ...(version ? { version } : {}),
      driveFileId: f.id, provider: "drive", url: f.webViewLink, mimeType: f.mimeType, ownerEmail: f.ownerEmail,
      inBandFolder: ins.inBandFolder, sharing: sharingOf(ins.missing), checkedAt: new Date(),
    });
  }
  return out;
}

export const releaseFilesAttach = defineCommand({
  name: "releases.files.attach", roles: ["admin", "mcp"],
  description: "Attach Drive files (driveFileId, see drive.search) or links (url) to a release (artwork, release masters, liner notes, promo) or, with trackId, to one of its tracks (mix, master, stems, session). " +
    "kind: mix|master|stems|session|artwork|liner|promo|other, guessed from the name when left out; a mix or master's version (v1, v2...) is read from the name or given. approved:true marks a mix or master signed off (the track becomes mixed / mastered). Returns { ids, skipped }.",
  input: z.strictObject({ releaseId: id1, trackId: id1.optional(), files: z.array(AttachFile).min(1), approved: z.boolean().optional() }),
  async run(ctx, i) {
    const release = await db.get("releases", i.releaseId);
    if (!release || release.deletedAt) throw new AppError("not_found", "Release not found", 404);
    const docs = await buildReleaseFileDocs(ctx.artistId, release, i.trackId, i.files);
    return run(ctx, async (w) => {
      await requireRelease(w, i.releaseId);
      const track = i.trackId ? await requireTrack(w, i.releaseId, i.trackId) : null;
      const have = await w.query("files", (q) => q.where("releaseId", "==", i.releaseId));
      const ids: string[] = [];
      let skipped = 0;
      for (const d of docs) {
        if (have.some((f) => (f.releaseTrackId ?? undefined) === (i.trackId ?? undefined) && (d.driveFileId ? f.driveFileId === d.driveFileId : f.url === d.url))) { skipped++; continue; }
        // A mix or master with no version in its name is the next one on the track.
        if (!d.version && (d.kind === "mix" || d.kind === "master") && track) {
          d.version = Math.max(0, ...have.filter((f) => f.releaseTrackId === track.id && f.kind === d.kind).map((f) => (f.version as number | undefined) ?? 0)) + 1;
        }
        const r = await w.create("files", { ...d, ...(i.approved ? { approved: true } : {}) });
        have.push({ ...d, id: r.id } as Doc);
        ids.push(r.id);
        if (i.approved && track) await advance(w, i.releaseId, track, d.kind as string);
      }
      return { ids, skipped };
    });
  },
});

/** An approved mix makes the track mixed, an approved master makes it mastered, unless it is already further along. */
async function advance(w: Writer, releaseId: string, track: Doc, kind: string) {
  const to = kind === "mix" ? "mixed" : kind === "master" ? "mastered" : null;
  if (to && !trackReached(track.status as never, to)) { await w.update(tracksPath(releaseId), track.id, { status: to }); track.status = to; }
}

async function requireReleaseFile(w: Writer, id: string): Promise<Doc> {
  const f = await w.get("files", id);
  if (!f || f.deletedAt || !f.releaseId) throw new AppError("not_found", "Release file not found", 404);
  return f;
}

export const releaseFilesApprove = defineCommand({
  name: "releases.files.approve", roles: ["admin", "mcp"],
  description: "Sign off a mix or master (approved:true): the track becomes mixed (a mix) or mastered (a master). approved:false takes the sign-off back; the track's status stays.",
  input: z.strictObject({ id: id1, approved: z.boolean() }),
  run: (ctx, { id, approved }) => run(ctx, async (w) => {
    const f = await requireReleaseFile(w, id);
    const r = await w.update("files", id, { approved: approved || null });
    if (approved && f.releaseTrackId) await advance(w, f.releaseId as string, await requireTrack(w, f.releaseId as string, f.releaseTrackId as string), f.kind as string);
    return r;
  }),
});

export const releaseFilesNote = defineCommand({
  name: "releases.files.note", roles: ["admin", "mcp"],
  description: "Leave a note on a mix or any release file (\"guitar solo a touch quieter\"), signed by the speaker. Returns { id: the note's id }.",
  input: z.strictObject({ id: id1, body: z.string().trim().min(1) }),
  run: (ctx, { id, body }) => run(ctx, async (w) => {
    const f = await requireReleaseFile(w, id);
    const u = await w.get("users", ctx.uid);
    const note = { id: randomUUID(), authorId: ctx.uid, name: (u?.name as string | undefined) ?? "", body, at: (ctx.now ?? new Date()).toISOString() };
    await w.update("files", id, { notes: [...((f.notes as unknown[] | undefined) ?? []), note] });
    return { id: note.id };
  }),
});

// ---------- the release's Drive folder ----------

export interface FolderInfo { id: string; name: string; url: string }
const info = (f: DriveFile): FolderInfo => ({ id: f.id, name: f.name, url: f.webViewLink });
const artistIdOf = (ctx: Ctx) => { if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400); return ctx.artistId; };

async function findOrMakeFolder(drive: DriveService, parent: string, name: string, mates: Bandmate[]): Promise<{ folder: DriveFile; made: boolean }> {
  const there = (await drive.search({ parent, mimeType: FOLDER_MIME })).find((f) => f.name === name);
  if (there) return { folder: there, made: false };
  const folder = await drive.createFolder(name, parent);
  await drive.share(folder.id, mates.map((m) => m.email));
  return { folder, made: true };
}

/**
 * "Band folder / Releases / {title}", made (and shared with the band) if it isn't there yet, and remembered on the release:
 * where uploads land. Needs the band folder (Settings > Google).
 */
export async function ensureReleaseFolder(ctx: Ctx, releaseId: string): Promise<FolderInfo> {
  const release = await db.get("releases", releaseId);
  if (!release || release.deletedAt) throw new AppError("not_found", "Release not found", 404);
  const drive = driveClient({ artistId: ctx.artistId });
  if (release.driveFolderId) {
    try { return info(await drive.get(release.driveFolderId as string)); } catch { /* gone from Drive: make it again */ }
  }
  const { band } = await bandFolders(ctx.artistId);
  if (!band) throw new AppError("no_band_folder", NO_BAND_FOLDER, 400);
  const mates = await bandmates();
  const releases = await findOrMakeFolder(drive, band, RELEASES_FOLDER_NAME, mates);
  const own = await findOrMakeFolder(drive, releases.folder.id, release.title as string, mates);
  await db.update(ctx, "releases", releaseId, { driveFolderId: own.folder.id, driveFolderName: own.folder.name });
  return info(own.folder);
}

export const releasesFolder = defineCommand({
  name: "releases.folder", roles: ["admin", "mcp"],
  description: "The release's Drive folder (Band folder / Releases / {title}), made and shared with the band if it isn't there yet. Returns { id, name, url }. Needs the band folder from Settings > Google.",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => ensureReleaseFolder(ctx, id),
});

export const releaseFilesCopyToFolder = defineCommand({
  name: "releases.files.copyToFolder", roles: ["admin", "mcp"],
  description: "Copy release files that sit outside the band's folders into the release's Drive folder, shared with the band, and point each file at its copy (the original stays where it was). Returns { copied, errors }.",
  input: z.strictObject({ releaseId: id1, ids: z.array(id1).min(1) }),
  async run(ctx, { releaseId, ids }) {
    const folder = await ensureReleaseFolder(ctx, releaseId);
    const release = (await db.get("releases", releaseId))!;
    const [mates, folders] = await Promise.all([bandmates(), releaseFolders(ctx.artistId, release)]);
    const drive = driveClient({ artistId: ctx.artistId });
    const files = (await db.list("files", (q) => q.where("releaseId", "==", releaseId))).filter((f) => ids.includes(f.id) && f.driveFileId);
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const errors: { id: string; title: string; message: string }[] = [];
    for (const f of files) {
      try {
        let file = await drive.get(f.driveFileId as string);
        let ins = await inspect(file, mates, folders, drive);
        if (!ins.inBandFolder) {
          const copy = await drive.copy(file.id, { parentId: folder.id, name: file.name });
          file = await drive.share(copy.id, mates.map((m) => m.email));
          ins = await inspect(file, mates, folders, drive);
        }
        updates.push({ id: f.id, patch: { driveFileId: file.id, url: file.webViewLink, ownerEmail: file.ownerEmail, mimeType: file.mimeType, inBandFolder: ins.inBandFolder, sharing: sharingOf(ins.missing), checkedAt: new Date() } });
      } catch (e) { errors.push({ id: f.id, title: f.title as string, message: (e as Error).message }); }
    }
    await run(ctx, async (w) => { for (const u of updates) await w.update("files", u.id, u.patch); });
    return { copied: updates.length, errors, folder };
  },
});

export const releaseCommands = [
  releasesCreate, releasesUpdate, releasesRemove, releasesFolder,
  releaseTracksAdd, releaseTracksUpdate, releaseTracksRemove, releaseTracksReorder, releaseTracksSideBreak,
  releaseFilesAttach, releaseFilesApprove, releaseFilesNote, releaseFilesCopyToFolder,
];
