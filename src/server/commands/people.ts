import { z } from "zod";
import { defineCommand } from "./types";
import { patchInput, idInput } from "./util";
import { db, run } from "../db";
import { adminAuth } from "../admin";
import { AppError } from "../errors";
import { Configuration, MusicianInput, ArtistInput, UserInput, email as emailSchema, slug, lowerEmail } from "@/schema";

async function syncClaims(uid: string, role: string, musicianId?: string | null) {
  await adminAuth().setCustomUserClaims(uid, { role, ...(musicianId ? { musicianId } : {}) });
}

export const usersAdd = defineCommand({
  name: "users.add",
  roles: ["admin"],
  description: "Invite a person by Google email as admin or member.",
  input: z.strictObject({
    email: z.string().transform(lowerEmail).pipe(emailSchema),
    name: z.string().min(1),
    role: z.enum(["admin", "member"]),
    mcpAccess: z.boolean().default(false),
    musicianId: z.string().optional(),
  }),
  async run(ctx, input) {
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
      const doc = { email: input.email, name: input.name, role: input.role, mcpAccess: input.mcpAccess, musicianId: input.musicianId };
      const existing = await w.get("users", uid);
      if (existing?.deletedAt) {
        await w.restore("users", uid);
        await w.update("users", uid, doc);
      } else if (existing) {
        throw new AppError("duplicate", "That email is already a user", 409);
      } else {
        await w.create("users", doc, { id: uid });
      }
      if (input.musicianId) await w.update("musicians", input.musicianId, { userId: uid });
      return { id: uid };
    });
    await syncClaims(uid, input.role, input.musicianId);
    return out;
  },
});

const userPatch = UserInput.pick({ name: true, role: true, mcpAccess: true, musicianId: true });

export const usersUpdate = defineCommand({
  name: "users.update",
  roles: ["admin"],
  description: "Change a user's name, role, AI access, or musician link.",
  input: patchInput(userPatch),
  async run(ctx, { id, patch }) {
    if (id === ctx.uid && patch.role === "member") throw new AppError("forbidden", "You can't demote yourself", 403);
    const out = await run(ctx, async (w) => {
      const before = await w.get("users", id);
      if (!before || before.deletedAt) throw new AppError("not_found", "User not found", 404);
      const res = await w.update("users", id, patch as Record<string, unknown>);
      const mid = patch.musicianId as string | null | undefined;
      if (mid !== undefined) {
        if (before.musicianId && before.musicianId !== mid) await w.update("musicians", before.musicianId, { userId: null });
        if (mid) await w.update("musicians", mid, { userId: id });
      }
      const after = await w.get("users", id);
      return { res, role: after!.role as string, musicianId: after!.musicianId as string | undefined };
    });
    await syncClaims(id, out.role, out.musicianId);
    if (patch.role) await adminAuth().revokeRefreshTokens(id);
    return { id, changed: out.res.changed };
  },
});

export const usersRemove = defineCommand({
  name: "users.remove",
  roles: ["admin"],
  description: "Remove a user's login (soft delete). Their musician record stays.",
  input: idInput,
  async run(ctx, { id }) {
    if (id === ctx.uid) throw new AppError("forbidden", "You can't remove yourself", 403);
    await run(ctx, async (w) => {
      const u = await w.get("users", id);
      await w.softDelete("users", id);
      if (u?.musicianId) await w.update("musicians", u.musicianId, { userId: null });
    });
    await adminAuth().setCustomUserClaims(id, {});
    await adminAuth().revokeRefreshTokens(id);
    return { id };
  },
});

export const musiciansCreate = defineCommand({
  name: "musicians.create",
  roles: ["admin", "mcp"],
  description: "Add a musician (member or sub). No login needed.",
  input: MusicianInput.omit({ userId: true }).extend({ active: z.boolean().default(true) }),
  run: (ctx, input) => db.create(ctx, "musicians", input),
});
export const musiciansUpdate = defineCommand({
  name: "musicians.update",
  roles: ["admin", "mcp"],
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

export const artistsCreate = defineCommand({
  name: "artists.create",
  roles: ["admin"],
  description: "Create an artist (who gets billed) with its configurations and sound gear.",
  input: ArtistIn.extend({
    links: ArtistInput.shape.links.default({}),
    soundGear: ArtistInput.shape.soundGear.default({ bandProvided: [], venueProvided: [] }),
    driveFolderId: z.string().default(""),
  }),
  run: (ctx, input) => db.create(ctx, "artists", withConfigIds(input)),
});
export const artistsUpdate = defineCommand({
  name: "artists.update",
  roles: ["admin"],
  description: "Edit the artist: name, configurations (name, billingName, musicianIds, gear), soundGear, links.",
  input: patchInput(ArtistIn),
  run: (ctx, { id, patch }) => db.update(ctx, "artists", id, withConfigIds(patch as { configurations?: z.infer<typeof ConfigIn>[] | null }) as Record<string, unknown>),
});

export const peopleCommands = [
  usersAdd, usersUpdate, usersRemove, musiciansCreate, musiciansUpdate, musiciansRemove, artistsCreate, artistsUpdate,
];
