import { z } from "zod";
import { AssistantPrefs } from "./assistant";
import { DrivingSettings } from "./driving";
import { entity, serverMask, email, id, ts } from "./common";

/**
 * A role is per artist. "admin" and "member" sign in to the app; "ai" is a login for AI tools only (MCP keys): it can't
 * sign in to the app or read Firestore, and it always has mcpAccess.
 */
export const ArtistRole = z.enum(["admin", "member", "ai"]);
export type ArtistRole = z.infer<typeof ArtistRole>;
/** One artist this person belongs to, and their role there. */
export const Membership = z.strictObject({
  artistId: id,
  role: ArtistRole,
  /** AI (MCP) access in THIS artist; only admins can have it. */
  mcpAccess: z.boolean().optional(),
  /** This person's musician record in THIS artist (the one link between a login and a musician since tenancy phase 7). */
  musicianId: id.optional(),
});
export type Membership = z.infer<typeof Membership>;

export const User = entity({
  email,
  name: z.string().min(1),
  /** The artists this login belongs to (at most one entry per artist). Set by users.add / users.update / users.remove. */
  artists: z.array(Membership).refine((ms) => new Set(ms.map((m) => m.artistId)).size === ms.length, "One entry per artist"),
  /** Computed from `artists` (src/schema/index.ts): the artist ids of every membership, so a server query can ask "who is in this artist". */
  artistIds: z.array(id).optional(),
  prefs: z.strictObject({ assistant: AssistantPrefs.optional() }).optional(),
  /** Home address and cars, for gas estimates (people.updateDriving / me.updateDriving). */
  driving: DrivingSettings.optional(),
  /** When this person agreed to the Terms by starting an artist (sign-up). Set only by the server. */
  acceptedTermsAt: ts.optional(),
});
export const UserInput = User.omit({ ...serverMask, artistIds: true });
export type User = z.infer<typeof User>;

/** A user's role in one artist ("" when they don't belong to it). Tolerates docs from before memberships. */
export function roleIn(user: object | null | undefined, artistId: string | null | undefined): ArtistRole | "" {
  const ms = (user as { artists?: unknown } | null | undefined)?.artists;
  if (!artistId || !Array.isArray(ms)) return "";
  return ((ms as Membership[]).find((m) => m.artistId === artistId)?.role) ?? "";
}
/**
 * Whether this user has AI (MCP) access in one artist. Reads that artist's membership only: its own `mcpAccess` (admins
 * only). "ai" memberships always have it.
 */
export function mcpIn(user: object | null | undefined, artistId: string | null | undefined): boolean {
  const u = user as { artists?: unknown } | null | undefined;
  if (!artistId || !Array.isArray(u?.artists)) return false;
  const m = (u.artists as Membership[]).find((x) => x.artistId === artistId);
  if (!m) return false;
  if (m.role === "ai") return true;
  if (m.role !== "admin") return false;
  return m.mcpAccess === true;
}
/** The app roles (not "ai") a user holds, as the `artists` custom claim: {artistId: role}. Firestore rules read it. */
export function artistClaims(user: object): Record<string, "admin" | "member"> {
  const out: Record<string, "admin" | "member"> = {};
  const ms = (user as { artists?: unknown }).artists;
  for (const m of (Array.isArray(ms) ? ms : []) as Membership[]) if (m.role === "admin" || m.role === "member") out[m.artistId] = m.role;
  return out;
}

/** The artist ids a users doc belongs to (`users.artistIds`, computed on every write). */
export function artistIdsOf(user: object): string[] {
  const ms = (user as { artists?: unknown }).artists;
  return [...new Set(((Array.isArray(ms) ? ms : []) as Membership[]).map((m) => m.artistId).filter((x) => typeof x === "string" && x))];
}
/** The artists a person is admin of (the `adminOf` claim). */
export function adminOfClaims(user: object): string[] {
  const ms = (user as { artists?: unknown }).artists;
  return ((Array.isArray(ms) ? ms : []) as Membership[]).filter((m) => m.role === "admin").map((m) => m.artistId);
}
/** This person's musician in each artist (the `musicians` claim): {artistId: musicianId}, app roles only. */
export function musicianClaims(user: object): Record<string, string> {
  const out: Record<string, string> = {};
  const ms = (user as { artists?: unknown }).artists;
  for (const m of (Array.isArray(ms) ? ms : []) as Membership[]) if ((m.role === "admin" || m.role === "member") && m.musicianId) out[m.artistId] = m.musicianId;
  return out;
}
