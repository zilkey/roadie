import { adminAuth } from "./admin";
import { db, type Doc } from "./db";
import { AppError } from "./errors";
import { artistClaims, type Membership } from "@/schema/users";

/** One artist the signed-in person can open in the app (admin or member there). */
export interface ArtistAccess { artistId: string; slug: string; name: string; role: "admin" | "member" }

/** The custom claims for a users doc: `{artists: {artistId: role}, musicianId?}`. Firestore rules read `artists`. */
export function claimsFor(user: Doc): Record<string, unknown> {
  return { artists: artistClaims(user), ...(user.musicianId ? { musicianId: user.musicianId as string } : {}) };
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

/** After sign-in: find the invite by email and set custom claims. */
export async function startSession(authHeader: string | null) {
  const m = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!m) throw new AppError("unauthenticated", "Missing bearer token", 401);
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(m[1]);
  } catch {
    throw new AppError("unauthenticated", "Invalid or expired token", 401);
  }
  const email = decoded.email?.toLowerCase();
  if (!email || decoded.email_verified === false) throw new AppError("unauthenticated", "A verified email is required", 401);
  const [user] = await db.list("users", (q) => q.where("email", "==", email).limit(5));
  if (!user) throw new AppError("not_invited", "This email hasn't been invited", 403);
  const memberships = (user.artists ?? []) as Membership[];
  if (!memberships.length) throw new AppError("not_invited", "This email hasn't been invited", 403);
  if (!memberships.some((x) => x.role === "admin" || x.role === "member")) throw new AppError("ai_only", "This login is for AI tools only; it can't sign in to the app", 403);
  const claims = claimsFor(user);
  await adminAuth().setCustomUserClaims(decoded.uid, claims);
  return {
    uid: decoded.uid, userId: user.id, name: user.name as string, email,
    ...(user.musicianId ? { musicianId: user.musicianId as string } : {}),
    mcpAccess: !!user.mcpAccess, artists: await artistsFor(user),
  };
}
