import { z } from "zod";
import { defineCommand } from "./types";
import { idInput, patchInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { driveClient, type DriveFile } from "../integrations";
import { calendarPreview, calendarRemove, calendarSend } from "../calendarSync";
import { bandFolders, bandmates, inspect, sharingOf, type Bandmate } from "../music";
import { guessKey, guessKind, isAttachable, providerFor, setlistTotal, transitionOf } from "@/lib/music";
import { showName, type ShowPlaceLike } from "@/lib/shows";
import { SongInput, dateStr, timeStr, rehearsalLocation } from "@/schema";

const kindEnum = z.enum(["chart", "demo", "rehearsal", "recording", "lyrics", "stems", "other"]);
// Exactly one of driveFileId (looked up in Drive) or url (a Spotify/YouTube/web link, no lookup; provider is guessed from the url unless given).
const AttachDrive = z.strictObject({ driveFileId: z.string().min(1), kind: kindEnum.optional(), key: z.string().optional(), title: z.string().optional() });
const AttachLink = z.strictObject({ url: z.string().url(), provider: z.enum(["spotify", "youtube", "web"]).optional(), kind: kindEnum.optional(), title: z.string().optional() });
const AttachFile = z.union([AttachDrive, AttachLink]);
type Attach = z.infer<typeof AttachFile>;

// ---------- files ----------

async function buildFileDocs(artistId: string | undefined, files: Attach[], parent: { songId?: string; rehearsalId?: string }, defaultKind?: z.infer<typeof kindEnum>) {
  const [mates, { all: folder }] = await Promise.all([bandmates(), bandFolders(artistId)]);
  const drive = driveClient({ artistId });
  const out: Record<string, unknown>[] = [];
  for (const a of files) {
    if (!("driveFileId" in a)) {
      // A link: built from what we were told, with NO network call and no Drive fields (see schema/files.ts).
      const p = a.provider ?? providerFor(a.url);
      if (p === "drive") throw new AppError("invalid_input", "Attach Drive files by driveFileId, not url", 400);
      const title = a.title?.trim() || a.url;
      out.push({ kind: a.kind ?? defaultKind ?? guessKind(title, undefined, p), title, ...parent, provider: p, url: a.url, checkedAt: new Date() });
      continue;
    }
    let f: DriveFile;
    try { f = await drive.get(a.driveFileId); } catch { throw new AppError("not_found", `Drive file ${a.driveFileId} not found`, 404); }
    const ins = await inspect(f, mates, folder, drive);
    const kind = a.kind ?? defaultKind ?? guessKind(f.name, f.mimeType);
    const key = a.key ?? (kind === "chart" ? guessKey(f.name) : undefined);
    out.push({
      kind, title: a.title?.trim() || f.name, ...parent, ...(key ? { key } : {}),
      driveFileId: f.id, provider: "drive", url: f.webViewLink, mimeType: f.mimeType, ownerEmail: f.ownerEmail,
      inBandFolder: ins.inBandFolder, sharing: sharingOf(ins.missing), checkedAt: new Date(),
    });
  }
  return out;
}

/** Create file docs, skipping ones already attached to the same song/rehearsal. */
async function writeFiles(w: Writer, docs: Record<string, unknown>[]) {
  const ids: string[] = [];
  let skipped = 0;
  for (const d of docs) {
    // Links have no driveFileId (and where(..., undefined) is rejected), so they dedupe on url instead.
    const same = d.driveFileId
      ? await w.query("files", (q) => q.where("driveFileId", "==", d.driveFileId))
      : await w.query("files", (q) => q.where("url", "==", d.url));
    if (same.some((s) => s.songId === d.songId && s.rehearsalId === d.rehearsalId)) { skipped++; continue; }
    ids.push((await w.create("files", d)).id);
  }
  return { ids, skipped };
}

export const driveSearch = defineCommand({
  name: "drive.search",
  roles: ["admin", "mcp"],
  description: "Search Drive for audio, video, Docs and Word files matching a song title. Each hit says which band members can't open it and whether it is in the band folder.",
  input: z.strictObject({ q: z.string().min(1) }),
  async run(ctx, { q }) {
    const drive = driveClient({ artistId: ctx.artistId });
    const [hits, mates, { all: folder }] = await Promise.all([drive.search({ q }), bandmates(), bandFolders(ctx.artistId)]);
    const out = [];
    for (const f of hits.filter((h) => isAttachable(h.mimeType))) {
      const ins = await inspect(f, mates, folder, drive);
      const kind = guessKind(f.name, f.mimeType);
      out.push({
        driveFileId: f.id, name: f.name, mimeType: f.mimeType, url: f.webViewLink, ownerEmail: f.ownerEmail,
        inBandFolder: ins.inBandFolder, missing: ins.missing, kind, key: kind === "chart" ? guessKey(f.name) ?? null : null,
      });
    }
    return { files: out, bandmates: mates };
  },
});

export const filesAttach = defineCommand({
  name: "files.attach",
  roles: ["admin", "mcp"],
  description: "Attach Drive files (driveFileId) or links (url: Spotify, YouTube, any web page) to a song, a rehearsal, or both (a song's take at that rehearsal) as files docs. For Drive files kind, key, owner, inBandFolder and sharing are filled in from Drive; links get none of those.",
  input: z.strictObject({ songId: z.string().min(1).optional(), rehearsalId: z.string().min(1).optional(), files: z.array(AttachFile).min(1) })
    .refine((v) => !!v.songId || !!v.rehearsalId, "Give a songId, a rehearsalId or both"),
  async run(ctx, input) {
    const parent = { ...(input.songId ? { songId: input.songId } : {}), ...(input.rehearsalId ? { rehearsalId: input.rehearsalId } : {}) };
    const docs = await buildFileDocs(ctx.artistId, input.files, parent, input.rehearsalId ? "rehearsal" : undefined);
    return run(ctx, async (w) => {
      if (input.songId) { const s = await w.get("songs", input.songId); if (!s || s.deletedAt) throw new AppError("not_found", "Song not found", 404); }
      if (input.rehearsalId) { const r = await w.get("rehearsals", input.rehearsalId); if (!r || r.deletedAt) throw new AppError("not_found", "Rehearsal not found", 404); }
      return writeFiles(w, docs);
    });
  },
});

export const filesUpdate = defineCommand({
  name: "files.update",
  roles: ["admin", "mcp"],
  description: "Change a file's kind, key or title.",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({ kind: kindEnum.optional(), key: z.string().nullable().optional(), title: z.string().min(1).optional() }) }),
  run: (ctx, { id, patch }) => db.update(ctx, "files", id, patch),
});
export const filesRemove = defineCommand({
  name: "files.remove",
  roles: ["admin", "mcp"],
  description: "Detach a file from its song (the Drive file is untouched).",
  input: idInput,
  run: (ctx, { id }) => db.softDelete(ctx, "files", id),
});

async function liveFiles(ids?: string[]): Promise<Doc[]> {
  // Only Drive files have anything to check or repair; links have no driveFileId, sharing or inBandFolder.
  const all = (await db.list("files")).filter((f) => f.driveFileId);
  return ids ? all.filter((f) => ids.includes(f.id)) : all;
}

type Fix = "check" | "share" | "copy";

/** Apply a Drive-level fix to one file. "copy" puts a shared copy in the Charts folder, "share" adds the people who can't open it. */
export const NO_CHARTS_FOLDER = "You need to tell me where the lyrics and charts should go: choose the Charts folder on Settings > Google";
type Folders = Awaited<ReturnType<typeof bandFolders>>;

async function fixInDrive(artistId: string | undefined, id: string, fix: Fix, mates: Bandmate[], folders: Folders) {
  const folder = folders.all;
  const drive = driveClient({ artistId });
  let file = await drive.get(id);
  let ins = await inspect(file, mates, folder, drive);
  let fixed = false;
  if (fix === "copy" && !ins.inBandFolder) {
    if (!folders.charts) throw new AppError("no_charts_folder", NO_CHARTS_FOLDER, 400);
    const copy = await drive.copy(file.id, { parentId: folders.charts, name: file.name });
    // Share the copy with the band so it holds without relying on the folder's sharing.
    file = await drive.share(copy.id, mates.map((m) => m.email));
    ins = await inspect(file, mates, folder, drive);
    fixed = true;
  } else if (fix === "share" && ins.missing.length) {
    file = await drive.share(file.id, mates.filter((m) => ins.missing.includes(m.id)).map((m) => m.email));
    ins = await inspect(file, mates, folder, drive);
    fixed = true;
  }
  return { file, ins, fixed, moved: file.id !== id };
}

/** Re-reads Drive for each file (after an optional fix) and writes sharing, inBandFolder and checkedAt. */
async function refresh(ctx: Parameters<typeof run>[0], files: Doc[], fix: Fix) {
  const [mates, folders] = await Promise.all([bandmates(), bandFolders(ctx.artistId)]);
  if (fix === "copy" && !folders.charts) throw new AppError("no_charts_folder", NO_CHARTS_FOLDER, 400);
  const folder = folders.band;
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const errors: { id: string; title: string; message: string }[] = [];
  let fixed = 0;
  for (const f of files) {
    try {
      const r = await fixInDrive(ctx.artistId, f.driveFileId, fix, mates, folders);
      if (r.fixed) fixed++;
      updates.push({ id: f.id, patch: {
        ...(r.moved ? { driveFileId: r.file.id, url: r.file.webViewLink, ownerEmail: r.file.ownerEmail } : {}),
        mimeType: r.file.mimeType, inBandFolder: r.ins.inBandFolder, sharing: sharingOf(r.ins.missing), checkedAt: new Date(),
      } });
    } catch (e) {
      errors.push({ id: f.id, title: f.title, message: (e as Error).message });
    }
  }
  await run(ctx, async (w) => { for (const u of updates) await w.update("files", u.id, u.patch); });
  const withGaps = updates.filter((u) => u.patch.sharing !== "ok").length;
  // Without a band folder nothing is in it, so "outside" means nothing: null, and bandFolder says why.
  const outsideBandFolder = folder ? updates.filter((u) => !u.patch.inBandFolder).length : null;
  return { checked: updates.length, fixed, withGaps, outsideBandFolder, bandFolder: !!folder, errors };
}

export const driveFix = defineCommand({
  name: "drive.fix",
  roles: ["admin", "mcp"],
  description: "Before attaching: copy Drive files into the band's Charts folder (lyrics, chord sheets...) or share them with the band. Returns each file's new id and state. Copy is refused until an admin chooses the Charts folder on Settings > Google.",
  input: z.strictObject({ driveFileIds: z.array(z.string().min(1)).min(1), fix: z.enum(["copy", "share"]) }),
  async run(ctx, { driveFileIds, fix }) {
    const [mates, folders] = await Promise.all([bandmates(), bandFolders(ctx.artistId)]);
    if (fix === "copy" && !folders.charts) throw new AppError("no_charts_folder", NO_CHARTS_FOLDER, 400);
    const out = [];
    for (const id of driveFileIds) {
      const r = await fixInDrive(ctx.artistId, id, fix, mates, folders).catch((e) => { throw new AppError("drive_error", `${id}: ${(e as Error).message}`, 502); });
      out.push({ oldId: id, driveFileId: r.file.id, url: r.file.webViewLink, ownerEmail: r.file.ownerEmail, inBandFolder: r.ins.inBandFolder, missing: r.ins.missing });
    }
    return { files: out };
  },
});

const fileIds = z.strictObject({ ids: z.array(z.string().min(1)).min(1) });

export const filesCheck = defineCommand({
  name: "files.check",
  roles: ["admin", "mcp"],
  description: "Run the sharing check: re-read Drive for every song file (or the given ids) and update sharing, inBandFolder and checkedAt.",
  input: z.strictObject({ ids: z.array(z.string().min(1)).optional() }),
  async run(ctx, { ids }) { return refresh(ctx, await liveFiles(ids), "check"); },
});
export const filesShareWithBand = defineCommand({
  name: "files.shareWithBand",
  roles: ["admin", "mcp"],
  description: "Share files with every band member who can't open them yet.",
  input: fileIds,
  async run(ctx, { ids }) { return refresh(ctx, await liveFiles(ids), "share"); },
});
export const filesCopyToBand = defineCommand({
  name: "files.copyToBand",
  roles: ["admin", "mcp"],
  description: "Copy files outside the band folder into the band's Charts folder (lyrics, chord sheets...), shared with the band, and point the file at the copy. Refused until an admin chooses the Charts folder on Settings > Google.",
  input: fileIds,
  async run(ctx, { ids }) { return refresh(ctx, await liveFiles(ids), "copy"); },
});

// ---------- songs ----------

export const songsCreate = defineCommand({
  name: "songs.create",
  roles: ["admin", "mcp"],
  description: "Add a song, optionally attaching Drive files (see drive.search) or links (url) in the same step.",
  input: SongInput.extend({ files: z.array(AttachFile).default([]) }),
  async run(ctx, { files, ...song }) {
    const docs = await buildFileDocs(ctx.artistId, files, {});
    return run(ctx, async (w) => {
      const { id } = await w.create("songs", song);
      const r = await writeFiles(w, docs.map((d) => ({ ...d, songId: id })));
      return { id, fileIds: r.ids };
    });
  },
});
export const songsUpdate = defineCommand({
  name: "songs.update",
  roles: ["admin", "mcp"],
  description: "Edit a song. Renames and key/length changes flow into setlists and rehearsals.",
  input: patchInput(SongInput),
  run: (ctx, { id, patch }) => db.update(ctx, "songs", id, patch as Record<string, unknown>),
});
export const songsRemove = defineCommand({
  name: "songs.remove",
  roles: ["admin"],
  description: "Archive a song (soft delete).",
  input: idInput,
  run: (ctx, { id }) => db.softDelete(ctx, "songs", id),
});

// ---------- setlists ----------

/**
 * A song item is either a reference to a song in the library (songId, which fills title/length/key) or an off-library
 * one-off that carries its own title -- a cover nobody catalogued. A break needs neither. Without the title arm, a
 * setlist seeded from a template holding an off-library song could not be saved again from the show page.
 */
const ItemIn = z.strictObject({
  type: z.enum(["song", "break"]), songId: z.string().min(1).optional(), title: z.string().optional(),
  lengthSec: z.number().int().min(0).optional(), key: z.string().optional(), note: z.string().optional(),
  // Alternates pinned to a song: library songs only (title and key come from the song). Extra keys a stored copy carries
  // (title, key) are dropped, so a list read back with records.get can be resent as is.
  alts: z.array(z.object({ songId: z.string().min(1) })).optional(),
}).refine((i) => i.type === "break" || !!i.songId || !!i.title?.trim(), "A song item needs a songId or a title")
  .refine((i) => i.type === "song" || !i.alts?.length, "Only a song can have alternates");

/** Ids of the library songs already on a stored list of items, alternates included. */
const songIdsOf = (items: unknown) => new Set(((items ?? []) as { songId?: string; alts?: { songId: string }[] }[])
  .flatMap((i) => [...(i.songId ? [i.songId] : []), ...(i.alts ?? []).map((a) => a.songId)]));

/**
 * Song items take title, length and key from the song; breaks default to 1:00 "Break". A song still in the Writing
 * phase can't go on a setlist: adding one is refused, except a song already on the list (`keep`), so a list holding a
 * song that moved back to Writing can still be saved. `skipWriting` drops them instead (seeding copies another list).
 */
async function resolveItems(w: Writer, items: z.infer<typeof ItemIn>[], opts: { keep?: Set<string>; skipWriting?: boolean } = {}) {
  /** The library song for a songId, or null when it's in Writing and `skipWriting` drops it. Same rules for alternates. */
  const song = async (songId: string) => {
    const s = await w.get("songs", songId);
    if (!s || s.deletedAt) throw new AppError("not_found", `Song ${songId} not found`, 404);
    if (s.status === "writing" && !opts.keep?.has(s.id)) {
      if (opts.skipWriting) return null;
      throw new AppError("invalid_input", `${s.title} is still being written. Move it to Learning or Playing to put it on a setlist.`, 400);
    }
    return s;
  };
  const alts = async (i: z.infer<typeof ItemIn>) => {
    const out: { songId: string; title: string; key?: string }[] = [];
    for (const a of i.alts ?? []) {
      if (a.songId === i.songId || out.some((x) => x.songId === a.songId)) continue;
      const s = await song(a.songId);
      if (s) out.push({ songId: s.id, title: s.title as string, ...(s.key ? { key: s.key as string } : {}) });
    }
    return out.length ? { alts: out } : {};
  };
  const out = [];
  for (const i of items) {
    if (i.type === "break") {
      out.push({ type: "break" as const, title: i.title?.trim() || "Break", lengthSec: i.lengthSec ?? 60, ...(i.note ? { note: i.note } : {}) });
      continue;
    }
    if (!i.songId) {
      // An off-library one-off: it has no song behind it, so its own title, length and key are all there is.
      out.push({
        type: "song" as const, title: i.title!.trim(),
        ...(i.lengthSec != null ? { lengthSec: i.lengthSec } : {}), ...(i.key ? { key: i.key } : {}), ...(i.note ? { note: i.note } : {}),
        ...await alts(i),
      });
      continue;
    }
    const s = await song(i.songId);
    if (!s) continue;
    out.push({
      type: "song" as const, songId: s.id, title: s.title as string,
      ...(s.lengthSec != null ? { lengthSec: s.lengthSec as number } : {}), ...(s.key ? { key: s.key as string } : {}), ...(i.note ? { note: i.note } : {}),
      ...await alts(i),
    });
  }
  return out;
}

export const setlistTemplatesCreate = defineCommand({
  name: "setlistTemplates.create",
  roles: ["admin", "mcp"],
  description: "Create a reusable setlist template from songs and breaks, in order. A song item can carry alts: [{ songId }], alternate songs pinned to it (they don't count toward the time). totalSec is computed. Seed a show's setlist from it with setlists.seed.",
  input: z.strictObject({ name: z.string().min(1), items: z.array(ItemIn).default([]) }),
  run: (ctx, { name, items }) => run(ctx, async (w) => w.create("setlistTemplates", { name, items: await resolveItems(w, items) })),
});
export const setlistTemplatesUpdate = defineCommand({
  name: "setlistTemplates.update",
  roles: ["admin", "mcp"],
  description: "Rename a setlist template or replace its items (the full ordered list).",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({ name: z.string().min(1).optional(), items: z.array(ItemIn).optional() }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const p: Record<string, unknown> = {};
    if (patch.name) p.name = patch.name;
    if (patch.items) p.items = await resolveItems(w, patch.items, { keep: songIdsOf((await w.get("setlistTemplates", id))?.items) });
    return w.update("setlistTemplates", id, p);
  }),
});
export const setlistTemplatesRemove = defineCommand({
  name: "setlistTemplates.remove",
  roles: ["admin"],
  description: "Archive a setlist template. Shows seeded from it keep their own copy.",
  input: idInput,
  run: (ctx, { id }) => run(ctx, async (w) => w.softDelete("setlistTemplates", id)),
});

type SetlistSource = { kind: "template" | "show"; id: string; name?: string };

/** A show's setlist lives at setlists/{showId}: create it, or update it (restoring first if it was archived). */
async function upsertShowSetlist(w: Writer, showId: string, items: Record<string, unknown>[], source?: SetlistSource) {
  const show = await w.get("shows", showId);
  if (!show || show.deletedAt) throw new AppError("not_found", "Show not found", 404);
  const existing = await w.get("setlists", showId);
  if (!existing) {
    await w.create("setlists", { items, ...(source ? { source } : {}) }, { id: showId });
    return;
  }
  if (existing.deletedAt) await w.restore("setlists", showId);
  await w.update("setlists", showId, { items, ...(source ? { source } : {}) });
}

export const setlistsSetItems = defineCommand({
  name: "setlists.setItems",
  roles: ["admin", "mcp"],
  description: "Replaces the show's whole setlist with this ordered list of songs and breaks (creates it if the show has none): read records.get setlists (id = the show id) first and resend every item you keep.  Song items take title, length and key from the song; songs still in the Writing phase can't be added. A song item can carry alts: [{ songId }], alternate songs pinned to it, which move with it and don't count toward the time. totalSec is computed.",
  input: z.strictObject({ showId: z.string().min(1), items: z.array(ItemIn) }),
  run: (ctx, { showId, items }) => run(ctx, async (w) => {
    await upsertShowSetlist(w, showId, await resolveItems(w, items, { keep: songIdsOf((await w.get("setlists", showId))?.items) }));
    return { showId };
  }),
});
export const setlistsSeed = defineCommand({
  name: "setlists.seed",
  roles: ["admin", "mcp"],
  description: "Seed a show's setlist from a setlist template or from another show's setlist (copies, alternates included, with song titles, lengths and keys refreshed from the songs). " +
    'mode "replace" swaps the whole list (default), "append" adds to the end. Records where it came from; later edits to either side don\'t touch the other. Copying another show\'s setlist with mode "replace" also copies its average transition (transitionSec). ' +
    'Returns { showId, added, total (items), lengthSec (the full length: songs + breaks + transitions), transitionSec }.',
  input: z.strictObject({
    showId: z.string().min(1),
    from: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("template"), id: z.string().min(1) }),
      z.strictObject({ kind: z.literal("show"), id: z.string().min(1) }),
    ]),
    mode: z.enum(["append", "replace"]).default("replace"),
  }),
  run: (ctx, { showId, from, mode }): Promise<{ showId: string; added: number; total: number; lengthSec: number; transitionSec: number }> => run(ctx, async (w) => {
    let srcItems: z.infer<typeof ItemIn>[];
    let name: string | undefined;
    let srcShow: Doc | null = null;
    if (from.kind === "template") {
      const t = await w.get("setlistTemplates", from.id);
      if (!t || t.deletedAt) throw new AppError("not_found", "Setlist template not found", 404);
      srcItems = (t.items ?? []) as typeof srcItems;
      name = t.name as string;
    } else {
      const sl = await w.get("setlists", from.id);
      const src = await w.get("shows", from.id);
      srcShow = src;
      if (!sl || sl.deletedAt) throw new AppError("not_found", "That show has no setlist", 404);
      srcItems = (sl.items ?? []) as typeof srcItems;
      name = src ? showName(src as ShowPlaceLike) : undefined;
    }
    // Re-resolve through the songs so the copies are fresh at seed time (an off-library item keeps its own title). Songs
    // that have gone back to the Writing phase since are left out.
    const added: Record<string, unknown>[] = await resolveItems(w, srcItems, { skipWriting: true });
    const prior = mode === "append" ? await w.get("setlists", showId) : null;
    const current = (prior && !prior.deletedAt ? prior.items ?? [] : []) as Record<string, unknown>[];
    const items = [...current, ...added];
    await upsertShowSetlist(w, showId, items, { kind: from.kind, id: from.id, ...(name ? { name } : {}) });
    // A copy of another show's list takes its transition too, so the two add up the same. Appending keeps this show's own.
    let transitionSec = transitionOf((await w.get("shows", showId)) as { transitionSec?: number } | null ?? undefined);
    if (srcShow && mode === "replace" && transitionOf(srcShow as { transitionSec?: number }) !== transitionSec) {
      transitionSec = transitionOf(srcShow as { transitionSec?: number });
      await w.update("shows", showId, { transitionSec });
    }
    return { showId, added: added.length, total: items.length, lengthSec: setlistTotal(items, transitionSec), transitionSec };
  }),
});
export const setlistsRemove = defineCommand({
  name: "setlists.remove",
  roles: ["admin"],
  description: "Clear a show's setlist (archives it; setlists.setItems or setlists.seed brings it back).",
  input: z.strictObject({ showId: z.string().min(1) }),
  run: (ctx, { showId }) => run(ctx, async (w) => w.softDelete("setlists", showId)),
});

// ---------- rehearsals ----------

const RehSong = z.strictObject({ songId: z.string().min(1), note: z.string().optional() });
async function resolveSongs(w: Writer, songs: z.infer<typeof RehSong>[]) {
  const out = [];
  for (const s of songs) {
    const d = await w.get("songs", s.songId);
    if (!d || d.deletedAt) throw new AppError("not_found", `Song ${s.songId} not found`, 404);
    out.push({ songId: d.id, title: d.title as string, ...(s.note ? { note: s.note } : {}) });
  }
  return out;
}
const RehFields = {
  date: dateStr, location: rehearsalLocation.optional(), venueId: z.string().min(1).optional(),
  startTime: timeStr.optional(), endTime: timeStr.optional(), personnel: z.array(z.string().min(1)).default([]),
  songs: z.array(RehSong).default([]), notes: z.string().optional(),
};
/** A location saved from the address autocomplete: always has coordinates (unlike a migrated name-only one). */
const LocationIn = z.strictObject({ name: z.string().optional(), address: z.string().min(1), lat: z.number(), lng: z.number() });

export const rehearsalsCreate = defineCommand({
  name: "rehearsals.create",
  roles: ["admin", "mcp"],
  description: "Create a rehearsal: date, place, who's coming, the songs (with notes). Recordings attach through files.attach with rehearsalId.",
  input: z.strictObject({ ...RehFields, files: z.array(AttachFile).default([]) }),
  async run(ctx, { songs, files, ...r }) {
    const docs = await buildFileDocs(ctx.artistId, files, {}, "rehearsal");
    return run(ctx, async (w) => {
      const { id } = await w.create("rehearsals", { ...r, songs: await resolveSongs(w, songs) });
      const res = await writeFiles(w, docs.map((d) => ({ ...d, rehearsalId: id })));
      return { id, fileIds: res.ids };
    });
  },
});
export const rehearsalsUpdate = defineCommand({
  name: "rehearsals.update",
  roles: ["admin", "mcp"],
  description: "Edit a rehearsal (date, start/end time, location, personnel, songs run, notes).",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({
    date: dateStr.optional(), location: rehearsalLocation.nullable().optional(), venueId: z.string().min(1).nullable().optional(),
    startTime: timeStr.nullable().optional(), endTime: timeStr.nullable().optional(), personnel: z.array(z.string().min(1)).optional(),
    songs: z.array(RehSong).optional(), notes: z.string().nullable().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const { songs, ...rest } = patch;
    return w.update("rehearsals", id, { ...rest, ...(songs ? { songs: await resolveSongs(w, songs) } : {}) });
  }),
});
export const rehearsalsSetLocation = defineCommand({
  name: "rehearsals.setLocation",
  roles: ["admin", "mcp"],
  description: "Set where a rehearsal is (name, address and coordinates from the address autocomplete, see geo.autocomplete), so members get directions and one-tap gas. Pass location null to clear it.",
  input: z.strictObject({ id: z.string().min(1), location: LocationIn.nullable() }),
  run: (ctx, { id, location }) => db.update(ctx, "rehearsals", id, { location }),
});

export const rehearsalsImportSetlist = defineCommand({
  name: "rehearsals.importSetlist",
  roles: ["admin", "mcp"],
  description: "Copy songs from a setlist template into a rehearsal (titles and song ids; breaks are skipped). songIds picks which; " +
    'mode "append" adds them to the end (default), "replace" swaps the whole list. Sets fromSetlistId; later edits to either side don\'t touch the other.',
  input: z.strictObject({
    id: z.string().min(1), templateId: z.string().min(1),
    songIds: z.array(z.string().min(1)).min(1), mode: z.enum(["append", "replace"]).default("append"),
  }),
  // Returns { id, added, total }: how many songs came in and how long the rehearsal's list is now.
  run: (ctx, { id, templateId, songIds, mode }): Promise<{ id: string; added: number; total: number }> => run(ctx, async (w) => {
    const reh = await w.get("rehearsals", id);
    if (!reh || reh.deletedAt) throw new AppError("not_found", "Rehearsal not found", 404);
    const sl = await w.get("setlistTemplates", templateId);
    if (!sl || sl.deletedAt) throw new AppError("not_found", "Setlist template not found", 404);
    const pick = new Set(songIds);
    const added = ((sl.items ?? []) as { type: string; songId?: string; title: string }[])
      .filter((x) => x.type === "song" && x.songId && pick.has(x.songId))
      .map((x) => ({ songId: x.songId as string, title: x.title }));
    const songs = mode === "replace" ? added : [...((reh.songs ?? []) as typeof added), ...added];
    await w.update("rehearsals", id, { songs, fromSetlistId: templateId });
    return { id, added: added.length, total: songs.length };
  }),
});

export const rehearsalsRemove = defineCommand({
  name: "rehearsals.remove",
  roles: ["admin"],
  description: "Archive a rehearsal and detach its recordings.",
  input: idInput,
  run: (ctx, { id }) => run(ctx, async (w) => {
    for (const f of await w.query("files", (q) => q.where("rehearsalId", "==", id))) await w.softDelete("files", f.id);
    return w.softDelete("rehearsals", id);
  }),
});

export const rehearsalsCalendarPreview = defineCommand({
  name: "rehearsals.calendarPreview", roles: ["admin", "mcp"], input: idInput,
  description: "Read-only: the rehearsal's event as rehearsals.calendar would send it to the band calendar: title, start and end (all day without a start time), location, notes and songs, who is invited (and who has no email), and whether it creates or updates.",
  run: (ctx, { id }) => calendarPreview(ctx, "rehearsals", id),
});

export const rehearsalsCalendar = defineCommand({
  name: "rehearsals.calendar", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), on: z.boolean() }),
  description: "Send the rehearsal's event to the band's Google Calendar with invites to everyone coming (on:true: creates it, or updates the one there), or take it off (on:false). " +
    "Saving a rehearsal never does this: show the person rehearsals.calendarPreview first. Written with the caller's own Google account.",
  run: (ctx, i) => (i.on ? calendarSend(ctx, "rehearsals", i.id) : calendarRemove(ctx, "rehearsals", i.id)),
});

export const musicCommands = [
  driveSearch, driveFix, filesAttach, filesUpdate, filesRemove, filesCheck, filesShareWithBand, filesCopyToBand,
  songsCreate, songsUpdate, songsRemove, setlistTemplatesCreate, setlistTemplatesUpdate, setlistTemplatesRemove, setlistsSetItems, setlistsSeed, setlistsRemove,
  rehearsalsCreate, rehearsalsUpdate, rehearsalsSetLocation, rehearsalsImportSetlist, rehearsalsRemove, rehearsalsCalendarPreview, rehearsalsCalendar,
];
export type { Bandmate };
