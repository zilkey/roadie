import { z } from "zod";
import { AssistantPrefs } from "./assistant";
import { entity, serverMask, email, id } from "./common";

/**
 * A role is per artist. "admin" and "member" sign in to the app; "ai" is a login for AI tools only (MCP keys): it can't
 * sign in to the app or read Firestore, and it always has mcpAccess.
 */
export const ArtistRole = z.enum(["admin", "member", "ai"]);
export type ArtistRole = z.infer<typeof ArtistRole>;
/** One artist this person belongs to, and their role there. */
export const Membership = z.strictObject({ artistId: id, role: ArtistRole });
export type Membership = z.infer<typeof Membership>;

export const User = entity({
  email,
  name: z.string().min(1),
  /** The artists this login belongs to (at most one entry per artist). Set by users.add / users.update / users.remove. */
  artists: z.array(Membership).refine((ms) => new Set(ms.map((m) => m.artistId)).size === ms.length, "One entry per artist"),
  musicianId: id.optional(),
  mcpAccess: z.boolean(),
  prefs: z.strictObject({ assistant: AssistantPrefs.optional() }).optional(),
});
export const UserInput = User.omit(serverMask);
export type User = z.infer<typeof User>;

/** A user's role in one artist ("" when they don't belong to it). Tolerates docs from before memberships. */
export function roleIn(user: object | null | undefined, artistId: string | null | undefined): ArtistRole | "" {
  const ms = (user as { artists?: unknown } | null | undefined)?.artists;
  if (!artistId || !Array.isArray(ms)) return "";
  return ((ms as Membership[]).find((m) => m.artistId === artistId)?.role) ?? "";
}
/** The app roles (not "ai") a user holds, as the `artists` custom claim: {artistId: role}. Firestore rules read it. */
export function artistClaims(user: object): Record<string, "admin" | "member"> {
  const out: Record<string, "admin" | "member"> = {};
  const ms = (user as { artists?: unknown }).artists;
  for (const m of (Array.isArray(ms) ? ms : []) as Membership[]) if (m.role === "admin" || m.role === "member") out[m.artistId] = m.role;
  return out;
}
