import { adminAuth } from "./admin";
import { db, type Doc } from "./db";
import { personCtx, systemCtx, type PersonCtx } from "./ctx";
import { pendingInvitesFor } from "./commands/invites";
import { AppError } from "./errors";
import { adminOfClaims, artistClaims, mcpIn, musicianClaims, type Membership } from "@/schema/users";
import { firestore } from "./admin";
import { SHARED_EDIT_REQUESTS, accessFor } from "./platform";

/** One artist the signed-in person can open in the app (admin or member there). */
export interface ArtistAccess { artistId: string; slug: string; name: string; role: "admin" | "member" }

/**
 * The custom claims for a users doc: `{artists: {artistId: role}, adminOf: [artistId], musicians: {artistId: musicianId}, musicianId?}`.
 * Firestore rules read `artists` (from tenancy phase 6 also `adminOf` and `musicians`). `musicianId` goes away in phase 7.
 */
export function claimsFor(user: object): Record<string, unknown> {
  const mid = legacyMusicianId(user);
  return { artists: artistClaims(user), adminOf: adminOfClaims(user), musicians: musicianClaims(user), ...(mid ? { musicianId: mid } : {}) };
}

/**
 * The one `musicianId` today's rules and browser read (until phases 5-7 move them onto the per-artist `musicians` map): the old
 * `users.musicianId`, else the musician of the person's only membership that has one. Phase 4 stopped writing users.musicianId.
 */
export function legacyMusicianId(user: object): string | undefined {
  const u = user as { musicianId?: unknown };
  if (typeof u.musicianId === "string" && u.musicianId) return u.musicianId;
  const ms = Object.values(musicianClaims(user));
  return ms.length === 1 ? ms[0] : undefined;
}

/** Firebase refuses custom claims over 1000 bytes; Roadie stops at 900 (about eight artists), before writing anything. */
export const CLAIMS_MAX_BYTES = 900;
export const claimsBytes = (claims: Record<string, unknown>) => Buffer.byteLength(JSON.stringify(claims), "utf8");
export const TOO_MANY_ARTISTS = "You're in the most artists Roadie supports";
/** Refuse a membership change whose claims wouldn't fit (users.add, artists.create; invites.accept from phase 4). */
export function assertClaimsFit(user: object) {
  if (claimsBytes(claimsFor(user)) > CLAIMS_MAX_BYTES) throw new AppError("too_many_artists", TOO_MANY_ARTISTS, 409);
}

/** Re-set a user's custom claims from their users doc (none when the doc is gone or soft-deleted). */
export async function syncClaims(uid: string): Promise<void> {
  const user = await db.get(systemCtx("sync claims"), "users", uid);
  await adminAuth().setCustomUserClaims(uid, user && !user.deletedAt ? claimsFor(user) : {});
}

/** The artists a user can open in the app, with their slug and name (live artists only, sorted by name). */
export async function artistsFor(user: Doc): Promise<ArtistAccess[]> {
  const ms = ((user.artists ?? []) as Membership[]).filter((m) => m.role === "admin" || m.role === "member");
  const sys = systemCtx("artists for");
  const docs = await Promise.all(ms.map((m) => db.get(sys, "artists", m.artistId)));
  return ms.flatMap((m, i) => {
    const a = docs[i];
    return a && !a.deletedAt && typeof a.slug === "string" ? [{ artistId: m.artistId, slug: a.slug, name: a.name as string, role: m.role as "admin" | "member" }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Verify a Bearer ID token with a verified email. */
async function verified(authHeader: string | null) {
  const m = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!m) throw new AppError("unauthenticated", "Missing bearer token", 401);
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(m[1]);
  } catch {
    throw new AppError("unauthenticated", "Invalid or expired token", 401);
  }
  const email = decoded.email?.trim().toLowerCase();
  if (!email || decoded.email_verified === false) throw new AppError("unauthenticated", "A verified email is required", 401);
  return { decoded, email };
}

/**
 * A verified person with no artist needed (tenancy plan D3): invites.list / accept / decline. Their users doc, if any, must be
 * live (a removed person gets nothing).
 */
export async function authenticatePerson(authHeader: string | null): Promise<PersonCtx> {
  const { decoded, email } = await verified(authHeader);
  const user = await db.get(systemCtx("authenticate person"), "users", decoded.uid);
  if (user?.deletedAt) throw new AppError("forbidden", "Account is not active", 403);
  return personCtx(decoded.uid, email);
}

/**
 * After sign-in: find the person by email and set custom claims. A verified account with no band gets `{status: "noBand"}`
 * instead of an error. Both answers carry the person's pending invites (other artists asking them to join), looked up before any
 * early return, so someone with no artist (or only an AI login) still sees them; a removed person sees none.
 */
export async function startSession(authHeader: string | null) {
  const { decoded, email } = await verified(authHeader);
  const sys = systemCtx("start session");
  const found = await db.list(sys, "users", (q) => q.where("email", "==", email).limit(5), { includeDeleted: true });
  const user = found.find((u) => !u.deletedAt) ?? found[0];
  if (user?.deletedAt) throw new AppError("not_invited", "This email hasn't been invited", 403);
  const invites = await pendingInvitesFor(email);
  const memberships = (user?.artists ?? []) as Membership[];
  const apps = memberships.filter((x) => x.role === "admin" || x.role === "member");
  if (!user || !apps.length) {
    if (user && memberships.length && !invites.length) throw new AppError("ai_only", "This login is for AI tools only; it can't sign in to the app", 403);
    // A verified Google account with no band yet: signed in, but nothing to open. Claims say so (Firestore rules then read nothing); they can start a band, or join one they're invited to.
    await adminAuth().setCustomUserClaims(decoded.uid, { artists: {} });
    return { status: "noBand" as const, uid: decoded.uid, email, name: (user?.name as string | undefined) ?? (typeof decoded.name === "string" && decoded.name.trim() ? decoded.name : email.split("@")[0]), invites };
  }
  const claims = claimsFor(user);
  await adminAuth().setCustomUserClaims(decoded.uid, claims);
  // Who may change shared directory records (venues, acts…), and who runs Roadie itself (the Platform page).
  const [access, asked] = await Promise.all([accessFor(user.id), firestore().collection(SHARED_EDIT_REQUESTS).doc(user.id).get()]);
  return {
    status: "ready" as const,
    uid: decoded.uid, userId: user.id, name: user.name as string, email,
    // Until the browser reads its musician per artist (phase 5): the old link, else the musician of the person's only membership.
    ...(legacyMusicianId(user) ? { musicianId: legacyMusicianId(user) } : {}),
    musicians: musicianClaims(user), invites,
    mcpAccess: ((user.artists ?? []) as Membership[]).some((x) => mcpIn(user, x.artistId)), artists: await artistsFor(user),
    sharedEditor: access.sharedEditor, platformAdmin: access.platformAdmin, sharedEditRequested: asked.exists,
  };
}
