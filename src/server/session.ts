import { adminAuth } from "./admin";
import { db, type Doc } from "./db";
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
  const u = user as { musicianId?: unknown };
  return {
    artists: artistClaims(user), adminOf: adminOfClaims(user), musicians: musicianClaims(user),
    ...(typeof u.musicianId === "string" && u.musicianId ? { musicianId: u.musicianId } : {}),
  };
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
  const user = await db.get("users", uid);
  await adminAuth().setCustomUserClaims(uid, user && !user.deletedAt ? claimsFor(user) : {});
}

/** The artists a user can open in the app, with their slug and name (live artists only, sorted by name). */
export async function artistsFor(user: Doc): Promise<ArtistAccess[]> {
  const ms = ((user.artists ?? []) as Membership[]).filter((m) => m.role === "admin" || m.role === "member");
  const docs = await Promise.all(ms.map((m) => db.get("artists", m.artistId)));
  return ms.flatMap((m, i) => {
    const a = docs[i];
    return a && !a.deletedAt && typeof a.slug === "string" ? [{ artistId: m.artistId, slug: a.slug, name: a.name as string, role: m.role as "admin" | "member" }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** After sign-in: find the invite by email and set custom claims. A verified account with no band gets `{status: "noBand"}` instead of an error. */
export async function startSession(authHeader: string | null) {
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
  const found = await db.list("users", (q) => q.where("email", "==", email).limit(5), { includeDeleted: true });
  const user = found.find((u) => !u.deletedAt) ?? found[0];
  if (user?.deletedAt) throw new AppError("not_invited", "This email hasn't been invited", 403);
  const memberships = (user?.artists ?? []) as Membership[];
  if (!user || !memberships.length) {
    // A verified Google account with no band yet: signed in, but nothing to open. Claims say so (Firestore rules then read nothing); they can start a band.
    await adminAuth().setCustomUserClaims(decoded.uid, { artists: {} });
    return { status: "noBand" as const, uid: decoded.uid, email, name: (user?.name as string | undefined) ?? (typeof decoded.name === "string" && decoded.name.trim() ? decoded.name : email.split("@")[0]) };
  }
  if (!memberships.some((x) => x.role === "admin" || x.role === "member")) throw new AppError("ai_only", "This login is for AI tools only; it can't sign in to the app", 403);
  const claims = claimsFor(user);
  await adminAuth().setCustomUserClaims(decoded.uid, claims);
  // Who may change shared directory records (venues, acts…), and who runs Roadie itself (the Platform page).
  const [access, asked] = await Promise.all([accessFor(user.id), firestore().collection(SHARED_EDIT_REQUESTS).doc(user.id).get()]);
  return {
    status: "ready" as const,
    uid: decoded.uid, userId: user.id, name: user.name as string, email,
    ...(user.musicianId ? { musicianId: user.musicianId as string } : {}),
    mcpAccess: ((user.artists ?? []) as Membership[]).some((x) => mcpIn(user, x.artistId)), artists: await artistsFor(user),
    sharedEditor: access.sharedEditor, platformAdmin: access.platformAdmin, sharedEditRequested: asked.exists,
  };
}
