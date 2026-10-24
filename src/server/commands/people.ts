import { z } from "zod";
import { defineCommand } from "./types";
import { patchInput, idInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { adminAuth } from "../admin";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { syncClaims } from "../session";
import { Configuration, MusicianInput, ArtistInput, UserInput, ArtistRole, email as emailSchema, slug, slugForArtist, lowerEmail, roleIn, type Membership } from "@/schema";

/** An "ai" login is for AI tools only (MCP), so it always has AI access. */
const mcpFor = (role: string, mcpAccess?: boolean | null) => (role === "ai" ? true : mcpAccess);

/** People commands act on the artist the caller is working in. */
function artistOfCtx(ctx: Ctx): string {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
}
const memberships = (u: Doc | null | undefined) => ((u?.artists ?? []) as Membership[]);
const withRole = (ms: Membership[], artistId: string, role: ArtistRole) =>
  ms.some((m) => m.artistId === artistId) ? ms.map((m) => (m.artistId === artistId ? { artistId, role } : m)) : [...ms, { artistId, role }];

export const usersAdd = defineCommand({
  name: "users.add",
  roles: ["admin"],
  description: "Invite a person by email to this artist as admin, member, or ai (AI tools only). Someone already in another artist joins this one too. Link an existing musician with musicianId, or pass musician to add them to the band at the same time.",
  input: z.strictObject({
    email: z.string().transform(lowerEmail).pipe(emailSchema),
    name: z.string().min(1),
    role: ArtistRole,
    mcpAccess: z.boolean().default(false),
    musicianId: z.string().optional(),
    /** Also make them a band member: a new musician record linked to this login. */
    musician: z.strictObject({ instruments: MusicianInput.shape.instruments }).optional(),
  }).refine((i) => !(i.musicianId && i.musician), { message: "Pass musicianId or musician, not both", path: ["musician"] }),
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
      if (input.musicianId) {
        const m = await w.get("musicians", input.musicianId);
        if (!m || m.deletedAt) throw new AppError("not_found", "Musician not found", 404);
        if (m.userId && m.userId !== uid) throw new AppError("conflict", "That musician already has a login", 409);
      }
      const existing = await w.get("users", uid);
      const live = existing && !existing.deletedAt ? existing : null;
      if (live && roleIn(live, artistId)) throw new AppError("duplicate", "That email is already a user", 409);
      if (live?.musicianId && (input.musicianId || input.musician)) throw new AppError("conflict", "That person is already linked to a musician", 409);
      const musicianId = input.musician
        ? (await w.create("musicians", { name: input.name, email: input.email, instruments: input.musician.instruments, active: true, userId: uid })).id
        : input.musicianId;
      if (live) {
        // Already a login in another artist: join this one too, keeping their name and other memberships.
        await w.update("users", uid, {
          artists: withRole(memberships(live), artistId, input.role),
          ...(input.role === "ai" || input.mcpAccess ? { mcpAccess: true } : {}),
          ...(musicianId ? { musicianId } : {}),
        });
      } else {
        const doc = { email: input.email, name: input.name, artists: [{ artistId, role: input.role }], mcpAccess: mcpFor(input.role, input.mcpAccess), musicianId };
        if (existing?.deletedAt) {
          await w.restore("users", uid);
          await w.update("users", uid, { ...doc, role: null }); // `role: null` drops the pre-membership field from old docs
        } else {
          await w.create("users", doc, { id: uid });
        }
      }
      if (input.musicianId) await w.update("musicians", input.musicianId, { userId: uid });
      return { id: uid, musicianId };
    });
    await syncClaims(uid);
    return out;
  },
});

const userPatch = z.strictObject({ name: UserInput.shape.name, role: ArtistRole, mcpAccess: UserInput.shape.mcpAccess, musicianId: UserInput.shape.musicianId });

export const usersUpdate = defineCommand({
  name: "users.update",
  roles: ["admin"],
  description: "Change a person's name, role in this artist (admin, member, ai), AI access, or musician link. An ai login always keeps AI access.",
  input: patchInput(userPatch),
  async run(ctx, { id, patch }) {
    const artistId = artistOfCtx(ctx);
    if (id === ctx.uid && patch.role && patch.role !== "admin") throw new AppError("forbidden", "You can't demote yourself", 403);
    if (patch.role === null) throw new AppError("invalid_input", "Role can't be cleared; remove the person instead", 400);
    const out = await run(ctx, async (w) => {
      const before = await w.get("users", id);
      if (!before || before.deletedAt || !roleIn(before, artistId)) throw new AppError("not_found", "User not found", 404);
      const { role, ...rest } = patch;
      const next: Record<string, unknown> = { ...rest };
      if (role) next.artists = withRole(memberships(before), artistId, role as ArtistRole);
      if ((role ?? roleIn(before, artistId)) === "ai") next.mcpAccess = true;
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
  description: "Take a person out of this artist. Their login is removed (soft delete) once they belong to no artist; their musician record stays.",
  input: idInput,
  async run(ctx, { id }) {
    const artistId = artistOfCtx(ctx);
    if (id === ctx.uid) throw new AppError("forbidden", "You can't remove yourself", 403);
    await run(ctx, async (w) => {
      const u = await w.get("users", id);
      if (!u || u.deletedAt || !roleIn(u, artistId)) throw new AppError("not_found", "User not found", 404);
      const rest = memberships(u).filter((m) => m.artistId !== artistId);
      if (rest.length) return void (await w.update("users", id, { artists: rest }));
      await w.softDelete("users", id);
      if (u.musicianId) await w.update("musicians", u.musicianId, { userId: null });
    });
    await syncClaims(id);
    await adminAuth().revokeRefreshTokens(id);
    return { id };
  },
});

export const musiciansCreate = defineCommand({
  name: "musicians.create",
  roles: ["admin"],
  description: "Add a musician (member or sub). No login needed.",
  input: MusicianInput.omit({ userId: true }).extend({ active: z.boolean().default(true) }),
  run: (ctx, input) => db.create(ctx, "musicians", input),
});
export const musiciansUpdate = defineCommand({
  name: "musicians.update",
  roles: ["admin"],
  description: "Edit a musician.",
  input: patchInput(MusicianInput.omit({ userId: true })),
  run: (ctx, { id, patch }) => db.update(ctx, "musicians", id, patch as Record<string, unknown>),
});
export const musiciansRemove = defineCommand({
  name: "musicians.remove",
  roles: ["admin"],
  description: "Archive a musician (soft delete).",
  input: idInput,
  run: (ctx, { id }) => db.softDelete(ctx, "musicians", id),
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
const ArtistIn = ArtistInput.extend({ configurations: z.array(ConfigIn) });

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
  description: "Create an artist (who gets billed) with its configurations. slug (the URL name) defaults to one made from the name. The person creating it becomes its admin.",
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

export const peopleCommands = [
  usersAdd, usersUpdate, usersRemove, musiciansCreate, musiciansUpdate, musiciansRemove, artistsCreate, artistsUpdate,
];
