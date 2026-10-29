import { z } from "zod";
import { randomUUID } from "node:crypto";
import { defineCommand } from "./types";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { driveClient, type DriveFile, type DriveService } from "../integrations";
import { FOLDER_MIME } from "../integrations/drive";
import { bandFolders, bandmates, inspect, sharingOf, type Bandmate } from "../music";
import { albumKind, albumStatus, trackStatus, trackCredit, fileKind, dateStr, cents, driveRef } from "@/schema";
import { guessAlbumKind, guessVersion, sidesFor, sortTracks, trackReached } from "@/lib/albums";
import { providerFor } from "@/lib/music";
import { artistFor } from "./projects";

// Albums (#12): an album is a record next to Songs: an ordered tracklist built from songs (albums/{id}/tracks), the files
// that only belong to the record (files docs with albumId / albumTrackId: mixes by version, masters, stems, artwork...),
// and its money, which is the project made with it (projectId, kind "album"), measured against the album's own budget.
// Songs are untouched: charts and demos stay on the song; a track points at its song.

const id1 = z.string().min(1);
export const tracksPath = (albumId: string) => `albums/${albumId}/tracks`;
export const ALBUMS_FOLDER_NAME = "Albums";
export const NO_BAND_FOLDER = "Choose the band folder on Settings > Google first: the album folder goes inside it";

async function requireAlbum(w: Writer, id: string): Promise<Doc> {
  const a = await w.get("albums", id);
  if (!a || a.deletedAt) throw new AppError("not_found", "Album not found", 404);
  if (w.ctx.artistId && a.artistId !== w.ctx.artistId) throw new AppError("not_found", "Album not found", 404);
  return a;
}
/** The album's live tracks in order. `pending` sees tracks this run has just written. */
async function liveTracks(w: Writer, albumId: string, pending = false): Promise<Doc[]> {
  return sortTracks((await w.query(tracksPath(albumId), undefined, { pending })) as (Doc & { position: number })[]);
}
async function requireTrack(w: Writer, albumId: string, id: string): Promise<Doc> {
  const t = await w.get(tracksPath(albumId), id);
  if (!t || t.deletedAt) throw new AppError("not_found", "Track not found", 404);
  return t;
}
async function liveSong(w: Writer, id: string): Promise<Doc> {
  const s = await w.get("songs", id);
  if (!s || s.deletedAt) throw new AppError("not_found", `Song ${id} not found`, 404);
  return s;
}

/**
 * Money on a track: the track must be on the album whose project the money is on. Used by expenses.add / income.add with
 * albumTrackId. Returns the track.
 */
export async function requireTrackOnProject(w: Writer, projectId: string | undefined, trackId: string): Promise<Doc> {
  const album = projectId ? (await w.query("albums", (q) => q.where("projectId", "==", projectId)))[0] : undefined;
  if (!album) throw new AppError("invalid_input", "That project has no album, so there is no track to put this on", 400);
  const t = await w.get(tracksPath(album.id), trackId);
  if (!t || t.deletedAt) throw new AppError("not_found", "Track not found on that album", 404);
  return t;
}

/** Write the next tracks onto the album: one per song not already on it, after the last track, on `side` (or the last track's). */
async function appendTracks(w: Writer, albumId: string, songIds: string[], side?: string) {
  const have = await liveTracks(w, albumId, true);
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
    const r = await w.create(tracksPath(albumId), {
      albumId, position, songId, title: s.title as string, status: "tracking", credits: [],
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
async function renumber(w: Writer, albumId: string, ordered: Doc[], keepSides = true) {
  const before = sortTracks(ordered as (Doc & { position: number })[]);
  const breaks = keepSides ? before.flatMap((t, i) => (i > 0 && t.side !== before[i - 1].side ? [i] : [])) : [];
  const sides = sidesFor(ordered.length, breaks);
  for (const [i, t] of ordered.entries()) {
    const patch: Record<string, unknown> = {};
    if (t.position !== i + 1) patch.position = i + 1;
    if ((t.side ?? undefined) !== sides[i]) patch.side = sides[i] ?? null;
    if (Object.keys(patch).length) await w.update(tracksPath(albumId), t.id, patch);
  }
}

// ---------- the album ----------

export const albumsCreate = defineCommand({
  name: "albums.create", roles: ["admin", "mcp"],
  description: "Start an album, EP or single: title, kind (album|ep|single, default album), status (planning|recording|mixing|mastering|released, default planning), releaseDate (YYYY-MM-DD, the target), budget (cents). " +
    "Makes its money project (kind album, same name) at the same time: every expense and income for the record goes on that project. The tracklist starts from setlistId (a setlist template's songs in order) and/or songIds (from search), or empty. " +
    "makeFolder:true also makes \"Band folder / Albums / {title}\" in Drive. Returns { id, projectId, trackIds, folder }.",
  input: z.strictObject({
    title: z.string().trim().min(1), kind: albumKind.default("album"), status: albumStatus.default("planning"), releaseDate: dateStr.optional(), budget: cents.nonnegative().optional(),
    setlistId: id1.optional(), songIds: z.array(id1).default([]), makeFolder: z.boolean().default(false),
  }),
  async run(ctx, i) {
    const r = await run(ctx, async (w) => {
      const artist = await artistFor(w);
      const project = await w.create("projects", { artistId: artist.id, kind: "album", name: i.title, status: "open" });
      const album = await w.create("albums", {
        artistId: artist.id, title: i.title, kind: i.kind, status: i.status, projectId: project.id,
        ...(i.releaseDate ? { releaseDate: i.releaseDate } : {}), ...(i.budget !== undefined ? { budget: i.budget } : {}),
      });
      const songIds = [...(i.setlistId ? await setlistSongIds(w, i.setlistId) : []), ...i.songIds];
      const tracks = await appendTracks(w, album.id, songIds);
      return { id: album.id, projectId: project.id, trackIds: tracks.ids };
    });
    // Drive is outside the transaction (run() may retry); a band without a band folder just gets no folder.
    const folder = i.makeFolder ? await ensureAlbumFolder(ctx, r.id).catch((e) => { if (e instanceof AppError && e.code === "no_band_folder") return null; throw e; }) : null;
    return { ...r, folder };
  },
});

export const albumsUpdate = defineCommand({
  name: "albums.update", roles: ["admin", "mcp"],
  description: "Edit an album (id from search): title (renames its project too), kind, status, releaseDate / budget (cents) / cover (a Drive file: { driveFileId, url }) / distributor / upc / formats (null clears).",
  input: z.strictObject({ id: id1, patch: z.strictObject({
    title: z.string().trim().min(1).optional(), kind: albumKind.optional(), status: albumStatus.optional(), releaseDate: dateStr.nullable().optional(),
    budget: cents.nonnegative().nullable().optional(), cover: driveRef.nullable().optional(), distributor: z.string().trim().nullable().optional(),
    upc: z.string().trim().nullable().optional(), formats: z.string().trim().nullable().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const a = await requireAlbum(w, id);
    const p: Record<string, unknown> = { ...patch };
    for (const k of ["distributor", "upc", "formats"] as const) if (p[k] === "") p[k] = null;
    if (patch.title && patch.title !== a.title) {
      const project = await w.get("projects", a.projectId as string);
      if (project && !project.deletedAt) await w.update("projects", project.id, { name: patch.title });
    }
    return w.update("albums", id, p);
  }),
});

export const albumsRemove = defineCommand({
  name: "albums.remove", roles: ["admin"],
  description: "Archive an album with its tracks and album-only files; its project is closed (never removed) so the money stays readable.",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => run(ctx, async (w) => {
    const a = await requireAlbum(w, id);
    for (const t of await liveTracks(w, id)) await w.softDelete(tracksPath(id), t.id);
    for (const f of await w.query("files", (q) => q.where("albumId", "==", id))) await w.softDelete("files", f.id);
    const project = await w.get("projects", a.projectId as string);
    if (project && !project.deletedAt && project.status !== "closed") await w.update("projects", project.id, { status: "closed" });
    return w.softDelete("albums", id);
  }),
});

// ---------- tracks ----------

export const albumTracksAdd = defineCommand({
  name: "albums.tracks.add", roles: ["admin", "mcp"],
  description: "Put songs on an album, after its last track: songIds (from search, in the order given) and/or setlistId (a setlist template: its songs in its order; breaks are skipped). " +
    "A song already on the album is skipped. side (\"A\", \"B\") puts them on that side; otherwise they take the last track's. Title and length start from the song. Returns { ids, skipped }.",
  input: z.strictObject({ albumId: id1, songIds: z.array(id1).default([]), setlistId: id1.optional(), side: z.string().trim().min(1).max(2).optional() })
    .refine((v) => v.songIds.length || v.setlistId, "Give songIds or a setlistId"),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireAlbum(w, i.albumId);
    const songIds = [...(i.setlistId ? await setlistSongIds(w, i.setlistId) : []), ...i.songIds];
    return appendTracks(w, i.albumId, songIds, i.side?.toUpperCase());
  }),
});

export const albumTracksUpdate = defineCommand({
  name: "albums.tracks.update", roles: ["admin", "mcp"],
  description: "Edit one track of an album (albumId, id from records.get albums / the album page): title (on the album; the song keeps its own), status (tracking|overdubs|mixing|mixed|mastered), isrc / lengthSec (null clears), explicit, credits (the whole list of { who, role }).",
  input: z.strictObject({ albumId: id1, id: id1, patch: z.strictObject({
    title: z.string().trim().min(1).optional(), status: trackStatus.optional(), isrc: z.string().trim().nullable().optional(), lengthSec: z.number().int().nonnegative().nullable().optional(),
    explicit: z.boolean().optional(), credits: z.array(trackCredit).optional(),
  }) }),
  run: (ctx, { albumId, id, patch }) => run(ctx, async (w) => {
    await requireAlbum(w, albumId);
    await requireTrack(w, albumId, id);
    const p: Record<string, unknown> = { ...patch };
    if (p.isrc === "") p.isrc = null;
    return w.update(tracksPath(albumId), id, p);
  }),
});

export const albumTracksRemove = defineCommand({
  name: "albums.tracks.remove", roles: ["admin", "mcp"],
  description: "Take a track off an album (its album-only files go with it; the song stays in Songs). The rest renumber.",
  input: z.strictObject({ albumId: id1, id: id1 }),
  run: (ctx, { albumId, id }) => run(ctx, async (w) => {
    await requireAlbum(w, albumId);
    await requireTrack(w, albumId, id);
    for (const f of await w.query("files", (q) => q.where("albumTrackId", "==", id))) await w.softDelete("files", f.id);
    const r = await w.softDelete(tracksPath(albumId), id);
    await renumber(w, albumId, (await liveTracks(w, albumId)).filter((t) => t.id !== id));
    return r;
  }),
});

export const albumTracksReorder = defineCommand({
  name: "albums.tracks.reorder", roles: ["admin", "mcp"],
  description: "Set the running order of an album: ids, every track of the album exactly once, in the new order. Side breaks stay where they were (by position).",
  input: z.strictObject({ albumId: id1, ids: z.array(id1).min(1) }),
  run: (ctx, { albumId, ids }) => run(ctx, async (w) => {
    await requireAlbum(w, albumId);
    const have = await liveTracks(w, albumId);
    const byId = new Map(have.map((t) => [t.id, t]));
    if (ids.length !== have.length || new Set(ids).size !== ids.length || ids.some((x) => !byId.has(x))) throw new AppError("invalid_input", "ids must name every track of the album once", 400);
    await renumber(w, albumId, ids.map((x) => byId.get(x)!));
    return { albumId, total: ids.length };
  }),
});

export const albumTracksSideBreak = defineCommand({
  name: "albums.tracks.sideBreak", roles: ["admin", "mcp"],
  description: "Side breaks (vinyl): atTrackId starts a new side at that track (the tracks before are Side A, from there Side B, and so on with more breaks); remove:true takes that break away; atTrackId null clears every side.",
  input: z.strictObject({ albumId: id1, atTrackId: id1.nullable(), remove: z.boolean().default(false) }),
  run: (ctx, { albumId, atTrackId, remove }) => run(ctx, async (w) => {
    await requireAlbum(w, albumId);
    const have = await liveTracks(w, albumId);
    const breaks = new Set(have.flatMap((t, i) => (i > 0 && t.side !== have[i - 1].side ? [i] : [])));
    if (atTrackId) {
      const at = have.findIndex((t) => t.id === atTrackId);
      if (at < 0) throw new AppError("not_found", "Track not found", 404);
      if (at === 0 && !remove) throw new AppError("invalid_input", "The first track can't start a new side", 400);
      if (remove) breaks.delete(at); else breaks.add(at);
    } else breaks.clear();
    const sides = sidesFor(have.length, [...breaks]);
    for (const [i, t] of have.entries()) if ((t.side ?? undefined) !== sides[i]) await w.update(tracksPath(albumId), t.id, { side: sides[i] ?? null });
    return { albumId, sides: [...new Set(sides.filter(Boolean))] };
  }),
});

// ---------- files: mixes, masters, stems, artwork... (files docs with albumId / albumTrackId) ----------

const AttachDrive = z.strictObject({ driveFileId: id1, kind: fileKind.optional(), title: z.string().optional(), version: z.number().int().positive().optional() });
const AttachLink = z.strictObject({ url: z.string().url(), provider: z.enum(["spotify", "youtube", "web"]).optional(), kind: fileKind.optional(), title: z.string().optional(), version: z.number().int().positive().optional() });
const AttachFile = z.union([AttachDrive, AttachLink]);
type Attach = z.infer<typeof AttachFile>;

/** The folders an album file counts as "in the band folder" under: the band's, plus the album's own. */
async function albumFolders(artistId: string | undefined, album: Doc) {
  const { all } = await bandFolders(artistId);
  return album.driveFolderId ? [...all, album.driveFolderId as string] : all;
}

/** File docs for the attachments, looked up in Drive (links get no Drive facts). Kind: given, else guessed from the name; version: given, else from the name. */
async function buildAlbumFileDocs(artistId: string | undefined, album: Doc, trackId: string | undefined, files: Attach[]) {
  const [mates, folders] = await Promise.all([bandmates(), albumFolders(artistId, album)]);
  const drive = driveClient({ artistId });
  const parent = { albumId: album.id, ...(trackId ? { albumTrackId: trackId } : {}) };
  const out: Record<string, unknown>[] = [];
  for (const a of files) {
    if (!("driveFileId" in a)) {
      const p = a.provider ?? providerFor(a.url);
      if (p === "drive") throw new AppError("invalid_input", "Attach Drive files by driveFileId, not url", 400);
      const title = a.title?.trim() || a.url;
      const version = a.version ?? guessVersion(title);
      out.push({ kind: a.kind ?? guessAlbumKind(title, undefined, !!trackId), title, ...parent, provider: p, url: a.url, ...(version ? { version } : {}), checkedAt: new Date() });
      continue;
    }
    let f: DriveFile;
    try { f = await drive.get(a.driveFileId); } catch { throw new AppError("not_found", `Drive file ${a.driveFileId} not found`, 404); }
    const ins = await inspect(f, mates, folders, drive);
    const title = a.title?.trim() || f.name;
    const version = a.version ?? guessVersion(f.name);
    out.push({
      kind: a.kind ?? guessAlbumKind(f.name, f.mimeType, !!trackId), title, ...parent, ...(version ? { version } : {}),
      driveFileId: f.id, provider: "drive", url: f.webViewLink, mimeType: f.mimeType, ownerEmail: f.ownerEmail,
      inBandFolder: ins.inBandFolder, sharing: sharingOf(ins.missing), checkedAt: new Date(),
    });
  }
  return out;
}

export const albumFilesAttach = defineCommand({
  name: "albums.files.attach", roles: ["admin", "mcp"],
  description: "Attach Drive files (driveFileId, see drive.search) or links (url) to an album (artwork, album masters, liner notes, promo) or, with trackId, to one of its tracks (mix, master, stems, session). " +
    "kind: mix|master|stems|session|artwork|liner|promo|other, guessed from the name when left out; a mix or master's version (v1, v2...) is read from the name or given. approved:true marks a mix or master signed off (the track becomes mixed / mastered). Returns { ids, skipped }.",
  input: z.strictObject({ albumId: id1, trackId: id1.optional(), files: z.array(AttachFile).min(1), approved: z.boolean().optional() }),
  async run(ctx, i) {
    const album = await db.get("albums", i.albumId);
    if (!album || album.deletedAt) throw new AppError("not_found", "Album not found", 404);
    const docs = await buildAlbumFileDocs(ctx.artistId, album, i.trackId, i.files);
    return run(ctx, async (w) => {
      await requireAlbum(w, i.albumId);
      const track = i.trackId ? await requireTrack(w, i.albumId, i.trackId) : null;
      const have = await w.query("files", (q) => q.where("albumId", "==", i.albumId));
      const ids: string[] = [];
      let skipped = 0;
      for (const d of docs) {
        if (have.some((f) => (f.albumTrackId ?? undefined) === (i.trackId ?? undefined) && (d.driveFileId ? f.driveFileId === d.driveFileId : f.url === d.url))) { skipped++; continue; }
        // A mix or master with no version in its name is the next one on the track.
        if (!d.version && (d.kind === "mix" || d.kind === "master") && track) {
          d.version = Math.max(0, ...have.filter((f) => f.albumTrackId === track.id && f.kind === d.kind).map((f) => (f.version as number | undefined) ?? 0)) + 1;
        }
        const r = await w.create("files", { ...d, ...(i.approved ? { approved: true } : {}) });
        have.push({ ...d, id: r.id } as Doc);
        ids.push(r.id);
        if (i.approved && track) await advance(w, i.albumId, track, d.kind as string);
      }
      return { ids, skipped };
    });
  },
});

/** An approved mix makes the track mixed, an approved master makes it mastered, unless it is already further along. */
async function advance(w: Writer, albumId: string, track: Doc, kind: string) {
  const to = kind === "mix" ? "mixed" : kind === "master" ? "mastered" : null;
  if (to && !trackReached(track.status as never, to)) { await w.update(tracksPath(albumId), track.id, { status: to }); track.status = to; }
}

async function requireAlbumFile(w: Writer, id: string): Promise<Doc> {
  const f = await w.get("files", id);
  if (!f || f.deletedAt || !f.albumId) throw new AppError("not_found", "Album file not found", 404);
  return f;
}

export const albumFilesApprove = defineCommand({
  name: "albums.files.approve", roles: ["admin", "mcp"],
  description: "Sign off a mix or master (approved:true): the track becomes mixed (a mix) or mastered (a master). approved:false takes the sign-off back; the track's status stays.",
  input: z.strictObject({ id: id1, approved: z.boolean() }),
  run: (ctx, { id, approved }) => run(ctx, async (w) => {
    const f = await requireAlbumFile(w, id);
    const r = await w.update("files", id, { approved: approved || null });
    if (approved && f.albumTrackId) await advance(w, f.albumId as string, await requireTrack(w, f.albumId as string, f.albumTrackId as string), f.kind as string);
    return r;
  }),
});

export const albumFilesNote = defineCommand({
  name: "albums.files.note", roles: ["admin", "mcp"],
  description: "Leave a note on a mix or any album file (\"guitar solo a touch quieter\"), signed by the speaker. Returns { id: the note's id }.",
  input: z.strictObject({ id: id1, body: z.string().trim().min(1) }),
  run: (ctx, { id, body }) => run(ctx, async (w) => {
    const f = await requireAlbumFile(w, id);
    const u = await w.get("users", ctx.uid);
    const note = { id: randomUUID(), authorId: ctx.uid, name: (u?.name as string | undefined) ?? "", body, at: (ctx.now ?? new Date()).toISOString() };
    await w.update("files", id, { notes: [...((f.notes as unknown[] | undefined) ?? []), note] });
    return { id: note.id };
  }),
});

// ---------- the album's Drive folder ----------

export interface FolderInfo { id: string; name: string; url: string }
const info = (f: DriveFile): FolderInfo => ({ id: f.id, name: f.name, url: f.webViewLink });

async function findOrMakeFolder(drive: DriveService, parent: string, name: string, mates: Bandmate[]): Promise<{ folder: DriveFile; made: boolean }> {
  const there = (await drive.search({ parent, mimeType: FOLDER_MIME })).find((f) => f.name === name);
  if (there) return { folder: there, made: false };
  const folder = await drive.createFolder(name, parent);
  await drive.share(folder.id, mates.map((m) => m.email));
  return { folder, made: true };
}

/**
 * "Band folder / Albums / {title}", made (and shared with the band) if it isn't there yet, and remembered on the album:
 * where uploads land. Needs the band folder (Settings > Google).
 */
export async function ensureAlbumFolder(ctx: Ctx, albumId: string): Promise<FolderInfo> {
  const album = await db.get("albums", albumId);
  if (!album || album.deletedAt) throw new AppError("not_found", "Album not found", 404);
  const drive = driveClient({ artistId: ctx.artistId });
  if (album.driveFolderId) {
    try { return info(await drive.get(album.driveFolderId as string)); } catch { /* gone from Drive: make it again */ }
  }
  const { band } = await bandFolders(ctx.artistId);
  if (!band) throw new AppError("no_band_folder", NO_BAND_FOLDER, 400);
  const mates = await bandmates();
  const albums = await findOrMakeFolder(drive, band, ALBUMS_FOLDER_NAME, mates);
  const own = await findOrMakeFolder(drive, albums.folder.id, album.title as string, mates);
  await db.update(ctx, "albums", albumId, { driveFolderId: own.folder.id });
  return info(own.folder);
}

export const albumsFolder = defineCommand({
  name: "albums.folder", roles: ["admin", "mcp"],
  description: "The album's Drive folder (Band folder / Albums / {title}), made and shared with the band if it isn't there yet. Returns { id, name, url }. Needs the band folder from Settings > Google.",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => ensureAlbumFolder(ctx, id),
});

export const albumFilesCopyToFolder = defineCommand({
  name: "albums.files.copyToFolder", roles: ["admin", "mcp"],
  description: "Copy album files that sit outside the band's folders into the album's Drive folder, shared with the band, and point each file at its copy (the original stays where it was). Returns { copied, errors }.",
  input: z.strictObject({ albumId: id1, ids: z.array(id1).min(1) }),
  async run(ctx, { albumId, ids }) {
    const folder = await ensureAlbumFolder(ctx, albumId);
    const album = (await db.get("albums", albumId))!;
    const [mates, folders] = await Promise.all([bandmates(), albumFolders(ctx.artistId, album)]);
    const drive = driveClient({ artistId: ctx.artistId });
    const files = (await db.list("files", (q) => q.where("albumId", "==", albumId))).filter((f) => ids.includes(f.id) && f.driveFileId);
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

export const albumCommands = [
  albumsCreate, albumsUpdate, albumsRemove, albumsFolder,
  albumTracksAdd, albumTracksUpdate, albumTracksRemove, albumTracksReorder, albumTracksSideBreak,
  albumFilesAttach, albumFilesApprove, albumFilesNote, albumFilesCopyToFolder,
];
