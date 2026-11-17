/**
 * Invites (tenancy plan Q2-A, D3 "Joining another artist"): adding someone who already belongs to another artist writes an invite,
 * not a membership. It becomes a membership (and a musician in the inviting artist, when the invite says so) only when the person
 * accepts it; declining, or an admin withdrawing it, deletes it. Until then the inviting artist sees only the invite.
 *
 * accept / decline / list run with a PersonCtx (`/api/invites/[id]/[action]`, `startSession`): the person has no membership in the
 * inviting artist yet, so the invite is looked up through the system view and the artist is reached only through `w.forArtist`.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc } from "../db";
import { AppError } from "../errors";
import { systemCtx, type PersonCtx } from "../ctx";
import { assertClaimsFit, syncClaims } from "../session";
import type { Membership } from "@/schema/users";

export interface PendingInvite { id: string; artistId: string; artistName: string; role: "admin" | "member"; invitedBy: string }

const sys = () => systemCtx("invites");

/** The live invites for a verified email, with the inviting artist's name (live artists only). */
export async function pendingInvitesFor(email: string): Promise<PendingInvite[]> {
  const rows = await db.list(sys(), "invites", (q) => q.where("email", "==", email.trim().toLowerCase()).limit(20));
  const out: PendingInvite[] = [];
  for (const r of rows) {
    const a = await db.get(sys(), "artists", r.artistId as string);
    if (!a || a.deletedAt) continue;
    const by = await db.get(sys(), "users", r.invitedBy as string);
    out.push({ id: r.id, artistId: r.artistId as string, artistName: a.name as string, role: r.role as "admin" | "member", invitedBy: (by?.name as string | undefined) ?? "" });
  }
  return out.sort((a, b) => a.artistName.localeCompare(b.artistName));
}

/** The invite `id`, only when it is live and addressed to the caller's verified email. */
async function myInvite(ctx: PersonCtx, id: string): Promise<Doc> {
  const inv = await db.get(sys(), "invites", id);
  if (!inv || inv.deletedAt || inv.email !== ctx.email.trim().toLowerCase()) throw new AppError("not_found", "Invite not found", 404);
  return inv;
}

/**
 * Join the inviting artist. Before any write: the invite is the caller's, and their claims still fit. Then, in one run, the
 * membership is added (History: the person's), the musician made or linked in that artist (History: the artist's), and the
 * invite deleted. The browser refreshes its token before opening the artist.
 */
export async function acceptInvite(ctx: PersonCtx, id: string) {
  const inv = await myInvite(ctx, id);
  const artistId = inv.artistId as string;
  const out = await run(ctx, async (w) => {
    const me = await w.get("users", ctx.uid);
    if (!me || me.deletedAt) throw new AppError("forbidden", "Account is not active", 403);
    const ms = ((me.artists ?? []) as Membership[]).filter((m) => m.artistId !== artistId);
    const role = inv.role as "admin" | "member";
    const membership: Membership = { artistId, role, ...(role === "admin" ? { mcpAccess: inv.mcpAccess === true } : {}) };
    assertClaimsFit({ ...me, artists: [...ms, { ...membership, musicianId: "x".repeat(20) }] });
    const there = w.forArtist(artistId);
    const want = inv.musician as { instruments: string[] } | { musicianId: string } | undefined;
    let musicianId: string | undefined;
    if (want && "musicianId" in want) {
      const m = await there.get("musicians", want.musicianId);
      if (!m || m.deletedAt) throw new AppError("not_found", "Musician not found", 404);
      if (m.userId && m.userId !== ctx.uid) throw new AppError("conflict", "That musician already has a login", 409);
      await there.update("musicians", m.id, { userId: ctx.uid, ...(m.email ? {} : { email: ctx.email }) });
      musicianId = m.id;
    } else if (want) {
      musicianId = (await there.create("musicians", { name: me.name, email: ctx.email, instruments: want.instruments, active: true, userId: ctx.uid })).id;
    }
    await w.update("users", ctx.uid, { artists: [...ms, { ...membership, ...(musicianId ? { musicianId } : {}) }] });
    await there.softDelete("invites", id);
    return { artistId, musicianId };
  });
  await syncClaims(ctx.uid);
  return out;
}

/** Say no: the invite is deleted. */
export async function declineInvite(ctx: PersonCtx, id: string) {
  const inv = await myInvite(ctx, id);
  await run(ctx, (w) => w.forArtist(inv.artistId as string).softDelete("invites", id));
  return { id };
}

export const invitesPending = defineCommand({
  name: "invites.pending",
  roles: ["admin"],
  description: "Read-only: people invited to this artist who haven't answered yet (they belong to another artist, so they join only when they accept): [{id, name, email, role}].",
  input: z.strictObject({}),
  async run(ctx) {
    const rows = await db.list(ctx, "invites");
    return { invites: rows.map((r) => ({ id: r.id, name: r.name as string, email: r.email as string, role: r.role as string })).sort((a, b) => a.name.localeCompare(b.name)) };
  },
});

export const invitesWithdraw = defineCommand({
  name: "invites.withdraw",
  roles: ["admin"],
  description: "Take back an invite that hasn't been answered (id from invites.pending).",
  input: idInput,
  run: (ctx, { id }) => db.softDelete(ctx, "invites", id),
});

export const inviteCommands = [invitesPending, invitesWithdraw];
