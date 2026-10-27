import { z } from "zod";
import { entity, serverMask, id, ts } from "./common";

/**
 * A long-lived key for the iOS Shortcut that sends voice memos to a rehearsal (/api/shortcut/*, src/server/shortcut.ts).
 * Doc id is the sha256 hash of the token (the raw token is shown once, never stored). One live token per admin per
 * artist: shortcut.createToken revokes the old one. Server-only: no Firestore read rule.
 */
export const ShortcutToken = entity({
  userId: id,
  artistId: id,
  lastUsedAt: ts.optional(),
  revokedAt: ts.optional(),
});
export const ShortcutTokenInput = ShortcutToken.omit(serverMask);
export type ShortcutToken = z.infer<typeof ShortcutToken>;
