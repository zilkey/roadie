/**
 * Who runs Roadie itself, and who may change the shared directory (multi-tenancy plan, phase 1).
 *
 * - `platform/admins {uids: string[]}`: platform admins (Jeff to start). Set by `scripts/platform-admins.ts`, never by an artist's admins.
 * - `platformUsers/{uid} {sharedEditorAt}`: a person a platform admin approved to edit existing shared records. Per person, not per
 *   artist: someone in several artists is approved once.
 * - `sharedEditRequests/{uid}`: someone asked to be approved ("Ask to edit"); a platform admin approves or denies it.
 *
 * All three are server-only (no client rule, not in `collections`): written straight to Firestore, kept by backups (SERVER_KEPT).
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { AppError } from "./errors";
import type { Ctx } from "./ctx";
import type { Membership } from "@/schema/users";
import { OWNERS } from "@/schema/owners";

/** The shared directory: one record every artist sees (the `shared` kinds of the owner table, src/schema/owners.ts). */
export const SHARED_KINDS = new Set(Object.entries(OWNERS).flatMap(([k, o]) => (o === "shared" ? [k] : [])));

export const PLATFORM_ADMINS_DOC = "platform/admins";
export const PLATFORM_USERS = "platformUsers";
export const SHARED_EDIT_REQUESTS = "sharedEditRequests";

const NOUN: Record<string, string> = { venues: "venues", venueTypes: "venue types", acts: "acts", promoters: "promoters", festivals: "festivals", editions: "festivals" };
/** What a refused edit says: "Only approved editors can change shared venues. Ask to edit, or add your own notes." */
export const refusedMessage = (kind: string) => `Only approved editors can change shared ${NOUN[kind] ?? "records"}. Ask to edit, or add your own notes.`;
/** Appended to the descriptions of commands that change shared records, so Roadie and MCP report a refusal instead of retrying. */
export const SHARED_EDIT_NOTE = " Changing an existing shared record needs approval: a person who isn't an approved shared editor gets 403 not_approved. Then tell them, suggest \"Ask to edit\" on its page (or this band's private notes), and don't retry.";
export const PLATFORM_ADMIN_ONLY = "Only Roadie's platform admins can merge or remove shared entries.";

export interface PlatformAccess { platformAdmin: boolean; sharedEditor: boolean }

async function readAccess(uid: string): Promise<PlatformAccess> {
  const fs = firestore();
  const [admins, user] = await Promise.all([fs.doc(PLATFORM_ADMINS_DOC).get(), fs.collection(PLATFORM_USERS).doc(uid).get()]);
  const uids = (admins.data()?.uids as string[] | undefined) ?? [];
  return { platformAdmin: uids.includes(uid), sharedEditor: !!user.data()?.sharedEditorAt };
}

/** Read once per call: the Ctx is the call (a command, a Roadie tool call), so an approval takes effect on the next one. */
const cache = new WeakMap<Ctx, Promise<PlatformAccess>>();
export function accessOf(ctx: Ctx): Promise<PlatformAccess> {
  let p = cache.get(ctx);
  if (!p) { p = readAccess(ctx.uid); cache.set(ctx, p); }
  return p;
}
/** Without a Ctx (startSession): a plain read. */
export const accessFor = (uid: string) => readAccess(uid);

export async function isPlatformAdmin(ctx: Ctx) { return (await accessOf(ctx)).platformAdmin; }
export async function isSharedEditor(ctx: Ctx) { return (await accessOf(ctx)).sharedEditor; }

/** Merge and remove on shared kinds rewrite every artist's records: platform admins only (Q3). */
export async function requirePlatformAdmin(ctx: Ctx) {
  if (!(await isPlatformAdmin(ctx))) throw new AppError("forbidden", PLATFORM_ADMIN_ONLY, 403);
}

// ---------- approvals (scripts and sharedEditors.*) ----------

/** Approve one person as a shared editor; their request (if any) is closed. */
export async function approveEditor(uid: string, by: string, now = Timestamp.now()) {
  const fs = firestore();
  const batch = fs.batch();
  batch.set(fs.collection(PLATFORM_USERS).doc(uid), { sharedEditorAt: now, approvedBy: by }, { merge: true });
  batch.delete(fs.collection(SHARED_EDIT_REQUESTS).doc(uid));
  await batch.commit();
}

export async function revokeEditor(uid: string, by: string) {
  await firestore().collection(PLATFORM_USERS).doc(uid).set({ sharedEditorAt: FieldValue.delete(), revokedBy: by, revokedAt: Timestamp.now() }, { merge: true });
}

/** Every live user with an admin or member role in `artistId` (Q10-A); `adminsOnly` for Q10-B. */
export async function membersOf(artistId: string, adminsOnly = false): Promise<{ uid: string; name: string; email: string; role: string }[]> {
  // users has no artistIds index field yet (phase 2 adds one): read them all; there are only a handful.
  const snap = await firestore().collection("users").get();
  return snap.docs.flatMap((d) => {
    const u = d.data();
    if (u.deletedAt) return [];
    const m = ((u.artists ?? []) as Membership[]).find((x) => x.artistId === artistId);
    if (!m || (adminsOnly ? m.role !== "admin" : m.role !== "admin" && m.role !== "member")) return [];
    return [{ uid: d.id, name: String(u.name ?? ""), email: String(u.email ?? ""), role: m.role }];
  });
}

/** Approve every member of one artist (the real artist, when phase 1 ships). Returns who was approved. */
export async function approveArtist(artistId: string, by: string, opts: { adminsOnly?: boolean } = {}) {
  const people = await membersOf(artistId, opts.adminsOnly);
  for (const p of people) await approveEditor(p.uid, by);
  return people;
}

/** Add uids to `platform/admins` (never removes). */
export async function addPlatformAdmins(uids: string[]) {
  await firestore().doc(PLATFORM_ADMINS_DOC).set({ uids: FieldValue.arrayUnion(...uids) }, { merge: true });
}
