import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineCommand } from "./types";
import { patchInput, idInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { adminAuth } from "../admin";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { syncClaims } from "../session";
import { seedDefaultTemplates } from "../checklistTemplates";
import { Configuration, MusicianInput, ArtistInput, UserInput, ArtistRole, TeamRole, TeamEmail, InstrumentList, OptionalEmail, PEOPLE_MESSAGES, slug, slugForArtist, roleIn, mcpIn, type Membership } from "@/schema";

/** People commands act on the artist the caller is working in. */
function artistOfCtx(ctx: Ctx): string {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
}
const memberships = (u: Doc | null | undefined) => ((u?.artists ?? []) as Membership[]);
/** Set this artist's membership (adding it if missing). AI access is stored on the membership, written for admins only (members and legacy "ai" carry none). */
const withRole = (ms: Membership[], artistId: string, role: ArtistRole, mcp = false): Membership[] => {
  const entry: Membership = { artistId, role, ...(role === "admin" ? { mcpAccess: mcp } : {}) };
  return ms.some((m) => m.artistId === artistId) ? ms.map((m) => (m.artistId === artistId ? entry : m)) : [...ms, entry];
};

const MSG = {
  lastAdmin: "Roadie needs at least one Admin",
  lastBandMember: "The band needs at least one Band Member",
  ownTeam: "You can't remove your own Team access",
  demoteSelf: "You can't demote yourself",
} as const;

/** Admins of this artist (live users only). */
async function adminsOf(w: Writer, artistId: string): Promise<Doc[]> {
  return (await w.query("users")).filter((u) => !u.deletedAt && roleIn(u, artistId) === "admin");
}
/** Band Members who are still in the band: not archived and active. */
async function bandOf(w: Writer): Promise<Doc[]> {
  return (await w.query("musicians")).filter((m) => !m.deletedAt && !m.archivedAt && m.active !== false);
}
const mcpIssue = () => new AppError("invalid_input", PEOPLE_MESSAGES.mcpAccess, 400, [{ path: ["mcpAccess"], message: PEOPLE_MESSAGES.mcpAccess }]);

/**
 * Take this artist's Team access away from a user (guards included). The login is soft-deleted once they belong to no
 * artist. Returns true when the login was deleted (the caller unlinks the musician).
 */
async function dropTeam(ctx: Ctx, w: Writer, user: Doc, artistId: string): Promise<boolean> {
  if (user.id === ctx.uid) throw new AppError("forbidden", MSG.ownTeam, 403);
  if (roleIn(user, artistId) === "admin" && (await adminsOf(w, artistId)).every((a) => a.id === user.id)) throw new AppError("forbidden", MSG.lastAdmin, 409);
  const rest = memberships(user).filter((m) => m.artistId !== artistId);
  if (rest.length) { await w.update("users", user.id, { artists: rest }); return false; }
  await w.softDelete("users", user.id);
  return true;
}
/** The live login linked to a musician (by either side of the link). */
async function userOfMusician(w: Writer, m: Doc): Promise<Doc | null> {
  if (m.userId) { const u = await w.get("users", m.userId as string); if (u && !u.deletedAt) return u; }
  return (await w.query("users", (q) => q.where("musicianId", "==", m.id).limit(1)))[0] ?? null;
}
async function liveMusician(w: Writer, id: string): Promise<Doc> {
  const m = await w.get("musicians", id);
  if (!m || m.deletedAt) throw new AppError("not_found", "Musician not found", 404);
  return m;
}
async function afterTeamChange(uid: string) {
  await syncClaims(uid);
  await adminAuth().revokeRefreshTokens(uid);
}

const personName = z.string().trim().min(1, PEOPLE_MESSAGES.name);

export const usersAdd = defineCommand({
  name: "users.add",
  roles: ["admin"],
  description: "Give a person Team access to this artist (role admin, or member shown as Standard; AI access only for admins). Someone already in another artist joins this one too. Link an existing Band Member with musicianId, or pass musician to make them a Band Member at the same time.",
  input: z.strictObject({
    email: TeamEmail,
    name: personName,
    role: TeamRole,
    mcpAccess: z.boolean().default(false),
    musicianId: z.string().optional(),
    /** Also make them a band member: a new musician record linked to this login. */
    musician: z.strictObject({ instruments: InstrumentList }).optional(),
  }).superRefine((i, ctx) => {
    if (i.musicianId && i.musician) ctx.addIssue({ code: "custom", path: ["musician"], message: "Pass musicianId or musician, not both" });
    if (i.mcpAccess && i.role !== "admin") ctx.addIssue({ code: "custom", path: ["mcpAccess"], message: PEOPLE_MESSAGES.mcpAccess });
  }),
  async run(ctx, input) {
    const artistId = artistOfCtx(ctx);
    const auth = adminAuth();
    let uid: string;
    try {
      uid = (await auth.getUserByEmail(input.email)).uid;
    } catch {
      uid = (await auth.createUser({ email: input.email, displayName: input.name, emailVerified: true })).uid;
    }
    const out = await run(ctx, async (w) => {
      const dupes = await w.query("users", (q) => q.where("email", "==", input.email));
      if (dupes.some((d) => d.id !== uid)) throw new AppError("duplicate", "That email is already a user", 409);
      let linked: Doc | null = null;
      if (input.musicianId) {
        linked = await w.get("musicians", input.musicianId);
        if (!linked || linked.deletedAt) throw new AppError("not_found", "Musician not found", 404);
        if (linked.archivedAt) throw new AppError("conflict", `${linked.name} is archived. Restore them first`, 409);
        if (linked.userId && linked.userId !== uid) throw new AppError("conflict", "That musician already has a login", 409);
      }
      const existing = await w.get("users", uid);
      const live = existing && !existing.deletedAt ? existing : null;
      if (live && roleIn(live, artistId)) throw new AppError("duplicate", "That email is already a user", 409);
      if (live?.musicianId && ((input.musicianId && input.musicianId !== live.musicianId) || input.musician)) throw new AppError("conflict", "That person is already linked to a musician", 409);
      const musicianId = input.musician
        ? (await w.create("musicians", { name: input.name, email: input.email, instruments: input.musician.instruments, active: true, userId: uid })).id
        : input.musicianId;
      const mcpAccess = input.role === "admin" && input.mcpAccess;
      if (live) {
        // Already a login in another artist: join this one too, keeping their name and other memberships.
        await w.update("users", uid, {
          artists: withRole(memberships(live), artistId, input.role, mcpAccess),
          ...(musicianId ? { musicianId } : {}),
        });
      } else {
        const doc = { email: input.email, name: input.name, artists: withRole([], artistId, input.role, mcpAccess), musicianId };
        if (existing?.deletedAt) {
          await w.restore("users", uid);
          await w.update("users", uid, { ...doc, role: null, mcpAccess: null }); // null drops the pre-membership role and the old global AI flag
        } else {
          await w.create("users", doc, { id: uid });
        }
      }
      if (input.musicianId) await w.update("musicians", input.musicianId, { userId: uid, ...(linked?.email ? {} : { email: input.email }) });
      return { id: uid, musicianId };
    });
    await syncClaims(uid);
    return out;
  },
});

const userPatch = z.strictObject({ name: personName, role: TeamRole, mcpAccess: UserInput.shape.mcpAccess, musicianId: UserInput.shape.musicianId });

export const usersUpdate = defineCommand({
  name: "users.update",
  roles: ["admin"],
  description: "Change a person's name, Team role in this artist (admin, or member shown as Standard), AI access (admins only; demoting an admin clears it), or Band Member link.",
  input: patchInput(userPatch),
  async run(ctx, { id, patch }) {
    const artistId = artistOfCtx(ctx);
    if (id === ctx.uid && patch.role && patch.role !== "admin") throw new AppError("forbidden", MSG.demoteSelf, 403);
    if (patch.role === null) throw new AppError("invalid_input", "Role can't be cleared; remove the person instead", 400);
    const out = await run(ctx, async (w) => {
      const before = await w.get("users", id);
      if (!before || before.deletedAt || !roleIn(before, artistId)) throw new AppError("not_found", "User not found", 404);
      const { role, mcpAccess: wantMcp, ...rest } = patch;
      const current = roleIn(before, artistId);
      const effective = (role as ArtistRole | undefined) ?? current;
      if (current === "admin" && effective !== "admin" && (await adminsOf(w, artistId)).every((a) => a.id === id)) throw new AppError("forbidden", MSG.lastAdmin, 409);
      const next: Record<string, unknown> = { ...rest };
      if (effective === "member" && wantMcp === true) throw mcpIssue();
      // AI access lives on this artist's membership only; other artists' memberships are left as they are.
      if (effective !== "ai" && (role || wantMcp !== undefined)) {
        next.artists = withRole(memberships(before), artistId, effective as ArtistRole, effective === "admin" && !!(wantMcp ?? mcpIn(before, artistId)));
      }
      const res = await w.update("users", id, next);
      const mid = patch.musicianId as string | null | undefined;
      if (mid !== undefined) {
        if (before.musicianId && before.musicianId !== mid) await w.update("musicians", before.musicianId, { userId: null });
        if (mid) await w.update("musicians", mid, { userId: id });
      }
      return { res };
    });
    await syncClaims(id);
    if (patch.role) await adminAuth().revokeRefreshTokens(id);
    return { id, changed: out.res.changed };
  },
});

export const usersRemove = defineCommand({
  name: "users.remove",
  roles: ["admin"],
  description: "Remove Team access: take a person out of this artist. Their Band Member record stays (with its email) so access can be given again. Their login is deleted once they belong to no artist. Refused for yourself and for the last Admin.",
  input: idInput,
  async run(ctx, { id }) {
    const artistId = artistOfCtx(ctx);
    await run(ctx, async (w) => {
      const u = await w.get("users", id);
      if (!u || u.deletedAt || !roleIn(u, artistId)) throw new AppError("not_found", "User not found", 404);
      const deleted = await dropTeam(ctx, w, u, artistId);
      if (deleted && u.musicianId) await w.update("musicians", u.musicianId, { userId: null });
    });
    await afterTeamChange(id);
    return { id };
  },
});

export const usersAddToBand = defineCommand({
  name: "users.addToBand",
  roles: ["admin"],
  description: "Make a Team-only person a Band Member. Un-archives their linked musician record (with these instruments) if they have one, otherwise creates and links one.",
  input: z.strictObject({ id: z.string().min(1), instruments: InstrumentList }),
  async run(ctx, { id, instruments }) {
    const artistId = artistOfCtx(ctx);
    return run(ctx, async (w) => {
      const u = await w.get("users", id);
      if (!u || u.deletedAt || !roleIn(u, artistId)) throw new AppError("not_found", "User not found", 404);
      const m = u.musicianId ? await w.get("musicians", u.musicianId as string) : null;
      if (m && !m.deletedAt) {
        if (!m.archivedAt && m.active !== false) throw new AppError("conflict", `${m.name} is already in the band`, 409);
        await w.update("musicians", m.id, { archivedAt: null, active: true, instruments, userId: id });
        return { id, musicianId: m.id };
      }
      const created = await w.create("musicians", { name: u.name, email: u.email, instruments, active: true, userId: id });
      await w.update("users", id, { musicianId: created.id });
      return { id, musicianId: created.id };
    });
  },
});

const musicianFields = MusicianInput.omit({ userId: true, archivedAt: true }).extend({
  name: personName,
  instruments: InstrumentList,
  email: OptionalEmail.optional(),
});

export const musiciansCreate = defineCommand({
  name: "musicians.create",
  roles: ["admin"],
  description: "Add a Band Member (member or sub) with at least one instrument. No login needed; use users.add with musician to also give Team access.",
  input: musicianFields.extend({ active: z.boolean().default(true) }),
  run: (ctx, input) => db.create(ctx, "musicians", input),
});
export const musiciansUpdate = defineCommand({
  name: "musicians.update",
  roles: ["admin"],
  description: "Edit a Band Member (name, instruments, email, phone, pay handle). Archive and restore have their own commands.",
  input: patchInput(musicianFields),
  run: (ctx, { id, patch }) => db.update(ctx, "musicians", id, patch as Record<string, unknown>),
});

/** Archive-like writes shared by musicians.archive / removeFromBand. dropTeamAccess also removes their Team access. */
async function leaveBand(ctx: Ctx, id: string, dropTeamAccess: boolean) {
  const artistId = artistOfCtx(ctx);
  const out = await run(ctx, async (w) => {
    const m = await liveMusician(w, id);
    const user = dropTeamAccess ? await userOfMusician(w, m) : null;
    const team = user && roleIn(user, artistId) ? user : null;
    const archiving = !m.archivedAt;
    if (archiving && !(await bandOf(w)).some((x) => x.id !== id)) throw new AppError("forbidden", MSG.lastBandMember, 409);
    const unlink = team ? await dropTeam(ctx, w, team, artistId) : false;
    if (!archiving && !unlink) return { changed: false, uid: team?.id };
    await w.update("musicians", id, { ...(archiving ? { archivedAt: new Date(), active: false } : {}), ...(unlink ? { userId: null } : {}) });
    return { changed: true, uid: team?.id };
  });
  if (out.uid) await afterTeamChange(out.uid);
  return { id, changed: out.changed };
}

export const musiciansArchive = defineCommand({
  name: "musicians.archive",
  roles: ["admin"],
  description: "Archive a person: they leave the band and lose this artist's Team access. They stay on past shows and pay by name. Refused for yourself, the last Admin, and the last Band Member.",
  input: idInput,
  run: (ctx, { id }) => leaveBand(ctx, id, true),
});
export const musiciansRemoveFromBand = defineCommand({
  name: "musicians.removeFromBand",
  roles: ["admin"],
  description: "Remove a person from the band (archives their Band Member record) but keep their Team access. Refused for the last Band Member.",
  input: idInput,
  run: (ctx, { id }) => leaveBand(ctx, id, false),
});
export const musiciansRestore = defineCommand({
  name: "musicians.restore",
  roles: ["admin"],
  description: "Bring an archived person back into the band. Does not give Team access back.",
  input: idInput,
  run: (ctx, { id }) => run(ctx, async (w) => {
    await liveMusician(w, id);
    return w.update("musicians", id, { archivedAt: null, active: true });
  }),
});
/** Kept for older callers: musicians are never deleted, so this archives (same as musicians.archive). */
export const musiciansRemove = defineCommand({
  name: "musicians.remove",
  roles: ["admin"],
  description: "Archive a person (same as musicians.archive). Musicians are never deleted.",
  input: idInput,
  run: (ctx, { id }) => leaveBand(ctx, id, true),
});

const ConfigIn = Configuration.extend({ id: z.string().optional() });
const withConfigIds = <T extends { configurations?: z.infer<typeof ConfigIn>[] | null }>(x: T) => {
  if (!x.configurations) return x;
  const used = new Set<string>();
  const configurations = x.configurations.map((c) => {
    let id = c.id || slug(c.name) || "config";
    while (used.has(id)) id += "-2";
    used.add(id);
    return { ...c, id };
  });
  return { ...x, configurations };
};
// songFields has its own commands: a plain patch could drop a field and leave its values behind on songs.
const ArtistIn = ArtistInput.omit({ songFields: true }).extend({ configurations: z.array(ConfigIn) });

/** Slugs are unique across artists (they are the URL: /artists/{slug}). Checked inside the write. */
async function requireFreeSlug(w: Writer, value: string, self?: string) {
  const taken = (await w.query("artists", (q) => q.where("slug", "==", value), { includeDeleted: true })).filter((a) => a.id !== self);
  if (taken.length) throw new AppError("slug_taken", `Another artist already uses "${value}"`, 409, [{ path: "slug", message: "Already taken" }]);
}
/** The first free slug for a name: "ingrid-avison", then "ingrid-avison-2"... */
async function freeSlugFor(w: Writer, name: string) {
  const base = slugForArtist(name);
  for (let n = 1; ; n++) {
    const s = n === 1 ? base : `${base}-${n}`;
    if (!(await w.query("artists", (q) => q.where("slug", "==", s), { includeDeleted: true })).length) return s;
  }
}

export const artistsCreate = defineCommand({
  name: "artists.create",
  roles: ["admin"],
  description: "Create an artist (who gets billed) with its configurations. slug (the URL name) defaults to one made from the name. The person creating it becomes its admin. It starts with the checklist templates Promo and Follow Up.",
  input: ArtistIn.extend({
    slug: ArtistInput.shape.slug.optional(),
    links: ArtistInput.shape.links.default({}),
    driveFolderId: z.string().default(""),
  }),
  async run(ctx, input) {
    const out = await run(ctx, async (w) => {
      if (input.slug) await requireFreeSlug(w, input.slug);
      const slugValue = input.slug ?? (await freeSlugFor(w, input.name));
      const r = await w.create("artists", withConfigIds({ ...input, slug: slugValue }));
      await seedDefaultTemplates(w, r.id);
      const me = await w.get("users", ctx.uid);
      if (me && !me.deletedAt) await w.update("users", ctx.uid, { artists: withRole(memberships(me), r.id, "admin") });
      return { ...r, slug: slugValue, joined: !!(me && !me.deletedAt) };
    });
    if (out.joined) await syncClaims(ctx.uid);
    return { id: out.id, merged: out.merged, slug: out.slug };
  },
});
export const artistsUpdate = defineCommand({
  name: "artists.update",
  roles: ["admin"],
  description: "Edit this artist: name, slug (its URL name, unique), configurations (name, billingName, musicianIds), links.",
  input: patchInput(ArtistIn),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    if (ctx.artistId && id !== ctx.artistId) throw new AppError("forbidden", "You can only edit the artist you're working in", 403);
    if (typeof patch.slug === "string") await requireFreeSlug(w, patch.slug, id);
    return w.update("artists", id, withConfigIds(patch as { configurations?: z.infer<typeof ConfigIn>[] | null }) as Record<string, unknown>);
  }),
});

// ---------- song fields (artist-defined label/value pairs on songs) ----------

type SongFieldDef = { id: string; label: string };
/** The artist this call is for, with its song fields. */
async function songFieldsOf(w: Writer, artistId: string) {
  if (w.ctx.artistId && artistId !== w.ctx.artistId) throw new AppError("forbidden", "You can only edit the artist you're working in", 403);
  const a = await w.get("artists", artistId);
  if (!a || a.deletedAt) throw new AppError("not_found", "Artist not found", 404);
  return (a.songFields ?? []) as SongFieldDef[];
}
const labelIn = z.string().trim().min(1);

export const artistsAddSongField = defineCommand({
  name: "artists.addSongField", roles: ["admin"],
  description: "Add a custom field every song of this artist can have a value for (e.g. \"Capo\", \"Tuning\"). Goes at the end. Returns the new field's id.",
  input: z.strictObject({ id: z.string().min(1), label: labelIn }),
  run: (ctx, i) => run(ctx, async (w) => {
    const fields = await songFieldsOf(w, i.id);
    const fieldId = randomUUID().slice(0, 8);
    await w.update("artists", i.id, { songFields: [...fields, { id: fieldId, label: i.label }] });
    return { id: i.id, fieldId };
  }),
});
export const artistsUpdateSongField = defineCommand({
  name: "artists.updateSongField", roles: ["admin"],
  description: "Rename a song field. Songs keep their values.",
  input: z.strictObject({ id: z.string().min(1), fieldId: z.string().min(1), label: labelIn }),
  run: (ctx, i) => run(ctx, async (w) => {
    const fields = await songFieldsOf(w, i.id);
    if (!fields.some((f) => f.id === i.fieldId)) throw new AppError("not_found", "No such song field", 404);
    return w.update("artists", i.id, { songFields: fields.map((f) => (f.id === i.fieldId ? { ...f, label: i.label } : f)) });
  }),
});
export const artistsRemoveSongField = defineCommand({
  name: "artists.removeSongField", roles: ["admin"],
  description: "Delete a song field and every song's value for it (not undoable by re-adding the field).",
  input: z.strictObject({ id: z.string().min(1), fieldId: z.string().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const fields = await songFieldsOf(w, i.id);
    if (!fields.some((f) => f.id === i.fieldId)) throw new AppError("not_found", "No such song field", 404);
    // Same transaction as the definition going away, so no song keeps a value for a field that no longer exists.
    // Songs aren't per-artist (no artistId): this project's songs are this artist's.
    const holders = (await w.query("songs")).filter((s) => ((s.fields ?? []) as { fieldId: string }[]).some((v) => v.fieldId === i.fieldId));
    for (const s of holders) await w.update("songs", s.id, { fields: (s.fields as { fieldId: string }[]).filter((v) => v.fieldId !== i.fieldId) });
    await w.update("artists", i.id, { songFields: fields.filter((f) => f.id !== i.fieldId) });
    return { id: i.id, songsCleared: holders.length };
  }),
});
export const artistsReorderSongFields = defineCommand({
  name: "artists.reorderSongFields", roles: ["admin"],
  description: "Put the artist's song fields in this order: fieldIds is every field's id, once.",
  input: z.strictObject({ id: z.string().min(1), fieldIds: z.array(z.string().min(1)) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const fields = await songFieldsOf(w, i.id);
    const same = i.fieldIds.length === fields.length && new Set(i.fieldIds).size === fields.length && fields.every((f) => i.fieldIds.includes(f.id));
    if (!same) throw new AppError("invalid_input", "Give every song field once (someone may have just added or deleted one)", 409);
    return w.update("artists", i.id, { songFields: i.fieldIds.map((fid) => fields.find((f) => f.id === fid)!) });
  }),
});

export const peopleCommands = [
  usersAdd, usersUpdate, usersRemove, usersAddToBand, musiciansCreate, musiciansUpdate, musiciansArchive, musiciansRemoveFromBand, musiciansRestore, musiciansRemove, artistsCreate, artistsUpdate,
  artistsAddSongField, artistsUpdateSongField, artistsRemoveSongField, artistsReorderSongFields,
];
