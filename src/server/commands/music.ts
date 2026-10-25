import { z } from "zod";
import { defineCommand } from "./types";
import { idInput, patchInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { driveClient, type DriveFile } from "../integrations";
import { bandFolderId, bandmates, inspect, sharingOf, type Bandmate } from "../music";
import { guessKey, guessKind, isAttachable, providerFor } from "@/lib/music";
import { SongInput, dateStr, timeStr, rehearsalLocation } from "@/schema";

const kindEnum = z.enum(["chart", "demo", "rehearsal", "recording", "lyrics", "stems", "other"]);
// Exactly one of driveFileId (looked up in Drive) or url (a Spotify/YouTube/web link, no lookup; provider is guessed from the url unless given).
const AttachDrive = z.strictObject({ driveFileId: z.string().min(1), kind: kindEnum.optional(), key: z.string().optional(), title: z.string().optional() });
const AttachLink = z.strictObject({ url: z.string().url(), provider: z.enum(["spotify", "youtube", "web"]).optional(), kind: kindEnum.optional(), title: z.string().optional() });
const AttachFile = z.union([AttachDrive, AttachLink]);
type Attach = z.infer<typeof AttachFile>;

// ---------- files ----------

async function buildFileDocs(artistId: string | undefined, files: Attach[], parent: { songId?: string; rehearsalId?: string }, defaultKind?: z.infer<typeof kindEnum>) {
  const [mates, folder] = await Promise.all([bandmates(), bandFolderId(artistId)]);
  const drive = driveClient();
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
    const ins = await inspect(f, mates, folder);
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
    const [hits, mates, folder] = await Promise.all([driveClient().search({ q }), bandmates(), bandFolderId(ctx.artistId)]);
    const out = [];
    for (const f of hits.filter((h) => isAttachable(h.mimeType))) {
      const ins = await inspect(f, mates, folder);
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
  description: "Attach Drive files (driveFileId) or links (url: Spotify, YouTube, any web page) to a song or a rehearsal as files docs. For Drive files kind, key, owner, inBandFolder and sharing are filled in from Drive; links get none of those.",
  input: z.strictObject({ songId: z.string().min(1).optional(), rehearsalId: z.string().min(1).optional(), files: z.array(AttachFile).min(1) })
    .refine((v) => !!v.songId !== !!v.rehearsalId, "Give exactly one of songId or rehearsalId"),
  async run(ctx, input) {
    const parent = input.songId ? { songId: input.songId } : { rehearsalId: input.rehearsalId };
    const docs = await buildFileDocs(ctx.artistId, input.files, parent, input.rehearsalId ? "rehearsal" : undefined);
    return run(ctx, async (w) => {
      const p = input.songId ? await w.get("songs", input.songId) : await w.get("rehearsals", input.rehearsalId!);
      if (!p || p.deletedAt) throw new AppError("not_found", input.songId ? "Song not found" : "Rehearsal not found", 404);
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

/** Apply a Drive-level fix to one file. "copy" moves it into the band folder (as a shared copy), "share" adds the people who can't open it. */
async function fixInDrive(id: string, fix: Fix, mates: Bandmate[], folder: string) {
  const drive = driveClient();
  let file = await drive.get(id);
  let ins = await inspect(file, mates, folder);
  let fixed = false;
  if (fix === "copy" && !ins.inBandFolder) {
    const copy = await drive.copy(file.id, { parentId: folder, name: file.name });
    // The band folder is shared with the band; share the copy too so it holds without relying on inheritance.
    file = await drive.share(copy.id, mates.map((m) => m.email));
    ins = await inspect(file, mates, folder);
    fixed = true;
  } else if (fix === "share" && ins.missing.length) {
    file = await drive.share(file.id, mates.filter((m) => ins.missing.includes(m.id)).map((m) => m.email));
    ins = await inspect(file, mates, folder);
    fixed = true;
  }
  return { file, ins, fixed, moved: file.id !== id };
}

/** Re-reads Drive for each file (after an optional fix) and writes sharing, inBandFolder and checkedAt. */
async function refresh(ctx: Parameters<typeof run>[0], files: Doc[], fix: Fix) {
  const [mates, folder] = await Promise.all([bandmates(), bandFolderId(ctx.artistId)]);
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const errors: { id: string; title: string; message: string }[] = [];
  let fixed = 0;
  for (const f of files) {
    try {
      const r = await fixInDrive(f.driveFileId, fix, mates, folder);
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
  const outsideBandFolder = updates.filter((u) => !u.patch.inBandFolder).length;
  return { checked: updates.length, fixed, withGaps, outsideBandFolder, errors };
}

export const driveFix = defineCommand({
  name: "drive.fix",
  roles: ["admin", "mcp"],
  description: "Before attaching: copy Drive files into the band folder or share them with the band. Returns each file's new id and state.",
  input: z.strictObject({ driveFileIds: z.array(z.string().min(1)).min(1), fix: z.enum(["copy", "share"]) }),
  async run(ctx, { driveFileIds, fix }) {
    const [mates, folder] = await Promise.all([bandmates(), bandFolderId(ctx.artistId)]);
    const out = [];
    for (const id of driveFileIds) {
      const r = await fixInDrive(id, fix, mates, folder).catch((e) => { throw new AppError("drive_error", `${id}: ${(e as Error).message}`, 502); });
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
  description: "Copy files outside the band folder into it (shared with the band) and point the file at the copy.",
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

const ItemIn = z.strictObject({
  type: z.enum(["song", "break"]), songId: z.string().min(1).optional(), title: z.string().optional(),
  lengthSec: z.number().int().min(0).optional(), key: z.string().optional(), note: z.string().optional(),
}).refine((i) => i.type === "break" || !!i.songId, "A song item needs songId");

/** Song items take title, length and key from the song; breaks default to 1:00 "Break". */
async function resolveItems(w: Writer, items: z.infer<typeof ItemIn>[]) {
  const out = [];
  for (const i of items) {
    if (i.type === "break") {
      out.push({ type: "break" as const, title: i.title?.trim() || "Break", lengthSec: i.lengthSec ?? 60, ...(i.note ? { note: i.note } : {}) });
      continue;
    }
    const s = await w.get("songs", i.songId!);
    if (!s || s.deletedAt) throw new AppError("not_found", `Song ${i.songId} not found`, 404);
    out.push({
      type: "song" as const, songId: s.id, title: s.title as string,
      ...(s.lengthSec != null ? { lengthSec: s.lengthSec as number } : {}), ...(s.key ? { key: s.key as string } : {}), ...(i.note ? { note: i.note } : {}),
    });
  }
  return out;
}

export const setlistsCreate = defineCommand({
  name: "setlists.create",
  roles: ["admin", "mcp"],
  description: "Create a setlist from songs and breaks, in order. totalSec is computed.",
  input: z.strictObject({ name: z.string().min(1), items: z.array(ItemIn).default([]) }),
  run: (ctx, { name, items }) => run(ctx, async (w) => w.create("setlists", { name, items: await resolveItems(w, items) })),
});
export const setlistsUpdate = defineCommand({
  name: "setlists.update",
  roles: ["admin", "mcp"],
  description: "Rename a setlist or replace its items (the full ordered list).",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({ name: z.string().min(1).optional(), items: z.array(ItemIn).optional() }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const p: Record<string, unknown> = {};
    if (patch.name) p.name = patch.name;
    if (patch.items) p.items = await resolveItems(w, patch.items);
    return w.update("setlists", id, p);
  }),
});
export const setlistsAttach = defineCommand({
  name: "setlists.attach",
  roles: ["admin", "mcp"],
  description: "Use a setlist for a show (sets show.setlistId and setlist.showId), or pass setlistId null to clear the show's setlist.",
  input: z.strictObject({ showId: z.string().min(1), setlistId: z.string().min(1).nullable() }),
  run: (ctx, { showId, setlistId }) => run(ctx, async (w) => {
    const show = await w.get("shows", showId);
    if (!show || show.deletedAt) throw new AppError("not_found", "Show not found", 404);
    const sl = setlistId ? await w.get("setlists", setlistId) : null;
    if (setlistId && (!sl || sl.deletedAt)) throw new AppError("not_found", "Setlist not found", 404);
    if (show.setlistId && show.setlistId !== setlistId) {
      const old = await w.get("setlists", show.setlistId);
      if (old && !old.deletedAt && old.showId === showId) await w.update("setlists", old.id, { showId: null });
    }
    if (sl?.showId && sl.showId !== showId) {
      const other = await w.get("shows", sl.showId);
      if (other && !other.deletedAt && other.setlistId === sl.id) await w.update("shows", other.id, { setlistId: null });
    }
    await w.update("shows", showId, { setlistId });
    if (sl) await w.update("setlists", sl.id, { showId });
    return { showId, setlistId };
  }),
});
export const setlistsRemove = defineCommand({
  name: "setlists.remove",
  roles: ["admin"],
  description: "Archive a setlist and detach it from its show.",
  input: idInput,
  run: (ctx, { id }) => run(ctx, async (w) => {
    const shows = await w.query("shows", (q) => q.where("setlistId", "==", id));
    for (const s of shows) await w.update("shows", s.id, { setlistId: null });
    return w.softDelete("setlists", id);
  }),
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
  description: "Log a rehearsal: date, place, who came, the songs run (with notes). Recordings attach through files.attach with rehearsalId.",
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
  description: "Copy songs from a setlist into a rehearsal (titles and song ids; breaks are skipped). songIds picks which; " +
    'mode "append" adds them to the end (default), "replace" swaps the whole list. Sets fromSetlistId; later edits to either side don\'t touch the other.',
  input: z.strictObject({
    id: z.string().min(1), setlistId: z.string().min(1),
    songIds: z.array(z.string().min(1)).min(1), mode: z.enum(["append", "replace"]).default("append"),
  }),
  // Returns { id, added, total }: how many songs came in and how long the rehearsal's list is now.
  run: (ctx, { id, setlistId, songIds, mode }): Promise<{ id: string; added: number; total: number }> => run(ctx, async (w) => {
    const reh = await w.get("rehearsals", id);
    if (!reh || reh.deletedAt) throw new AppError("not_found", "Rehearsal not found", 404);
    const sl = await w.get("setlists", setlistId);
    if (!sl || sl.deletedAt) throw new AppError("not_found", "Setlist not found", 404);
    const pick = new Set(songIds);
    const added = ((sl.items ?? []) as { type: string; songId?: string; title: string }[])
      .filter((x) => x.type === "song" && x.songId && pick.has(x.songId))
      .map((x) => ({ songId: x.songId as string, title: x.title }));
    const songs = mode === "replace" ? added : [...((reh.songs ?? []) as typeof added), ...added];
    await w.update("rehearsals", id, { songs, fromSetlistId: setlistId });
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

export const musicCommands = [
  driveSearch, driveFix, filesAttach, filesUpdate, filesRemove, filesCheck, filesShareWithBand, filesCopyToBand,
  songsCreate, songsUpdate, songsRemove, setlistsCreate, setlistsUpdate, setlistsAttach, setlistsRemove,
  rehearsalsCreate, rehearsalsUpdate, rehearsalsSetLocation, rehearsalsImportSetlist, rehearsalsRemove,
];
export type { Bandmate };
