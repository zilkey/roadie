/**
 * Approved editors for the shared directory (tenancy plan, phase 1). Anyone signed in can ask (the "Ask to edit" button on a
 * venue, act, promoter or festival page); Roadie's platform admins see the requests on Admin › Platform and approve, deny or revoke.
 */
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { defineCommand } from "./types";
import { firestore } from "../admin";
import { db } from "../db";
import { AppError } from "../errors";
import { PLATFORM_USERS, SHARED_EDIT_REQUESTS, accessOf, approveEditor, requirePlatformAdmin, revokeEditor } from "../platform";

const APP = ["admin", "member"] as const;
const uidInput = z.strictObject({ uid: z.string().min(1) });
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);

export const sharedEditorsRequest = defineCommand({
  name: "sharedEditors.request", roles: [...APP],
  description: "Ask Roadie's platform admins to approve you as a shared editor, so you can change shared venues, acts, promoters and festivals. The \"Ask to edit\" button.",
  input: z.strictObject({ note: z.string().trim().max(500).optional() }),
  async run(ctx, { note }) {
    const a = await accessOf(ctx);
    if (a.sharedEditor || a.platformAdmin) return { approved: true };
    const [user, artist] = await Promise.all([db.get("users", ctx.uid), ctx.artistId ? db.get("artists", ctx.artistId) : null]);
    await firestore().collection(SHARED_EDIT_REQUESTS).doc(ctx.uid).set({
      uid: ctx.uid, name: user?.name ?? "", email: user?.email ?? "", artistId: ctx.artistId ?? null, artistName: artist?.name ?? null,
      ...(note ? { note } : {}), requestedAt: Timestamp.now(),
    });
    return { requested: true };
  },
});

export const sharedEditorsList = defineCommand({
  name: "sharedEditors.list", roles: [...APP],
  description: "Roadie's platform admins only: open requests to edit shared records, and everyone approved.",
  input: z.strictObject({}),
  async run(ctx) {
    await requirePlatformAdmin(ctx);
    const fs = firestore();
    const [reqs, approved] = await Promise.all([
      fs.collection(SHARED_EDIT_REQUESTS).orderBy("requestedAt", "desc").get(),
      fs.collection(PLATFORM_USERS).where("sharedEditorAt", "!=", null).get(),
    ]);
    const users = await Promise.all(approved.docs.map((d) => db.get("users", d.id)));
    return {
      requests: reqs.docs.map((d) => {
        const r = d.data();
        return { uid: d.id, name: r.name as string, email: r.email as string, artistName: (r.artistName as string | null) ?? null, note: (r.note as string | undefined) ?? null, requestedAt: iso(r.requestedAt) };
      }),
      editors: approved.docs.map((d, i) => ({ uid: d.id, name: (users[i]?.name as string | undefined) ?? d.id, email: (users[i]?.email as string | undefined) ?? "", approvedAt: iso(d.data().sharedEditorAt) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

async function requireUser(uid: string) {
  const u = await db.get("users", uid);
  if (!u || u.deletedAt) throw new AppError("not_found", "No such person", 404);
}

export const sharedEditorsApprove = defineCommand({
  name: "sharedEditors.approve", roles: [...APP], input: uidInput,
  description: "Roadie's platform admins only: approve a person to change shared records (closes their request).",
  async run(ctx, { uid }) {
    await requirePlatformAdmin(ctx);
    await requireUser(uid);
    await approveEditor(uid, ctx.uid);
    return { uid, approved: true };
  },
});

export const sharedEditorsDeny = defineCommand({
  name: "sharedEditors.deny", roles: [...APP], input: uidInput,
  description: "Roadie's platform admins only: turn down a request to edit shared records (they can ask again).",
  async run(ctx, { uid }) {
    await requirePlatformAdmin(ctx);
    await firestore().collection(SHARED_EDIT_REQUESTS).doc(uid).delete();
    return { uid, denied: true };
  },
});

export const sharedEditorsRevoke = defineCommand({
  name: "sharedEditors.revoke", roles: [...APP], input: uidInput,
  description: "Roadie's platform admins only: take away a person's approval to change shared records.",
  async run(ctx, { uid }) {
    await requirePlatformAdmin(ctx);
    await revokeEditor(uid, ctx.uid);
    return { uid, revoked: true };
  },
});

export const sharedEditorCommands = [sharedEditorsRequest, sharedEditorsList, sharedEditorsApprove, sharedEditorsDeny, sharedEditorsRevoke];
