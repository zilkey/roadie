/**
 * Token → artist, before a ctx exists (tenancy plan D3): MCP keys (`mcpTokens`) and iOS Shortcut tokens (`shortcutTokens`) are
 * stored under the sha256 of the raw token, and each is bound to one artist. The callers check revocation and the person's
 * membership; this only finds the token and the artist it names.
 */
import { db, type Doc } from "./db";
import { systemCtx } from "./ctx";

export type TokenKind = "mcpTokens" | "shortcutTokens";

/** The live (not soft-deleted) token stored under `hash`, and the artist it is bound to (null for an older MCP key that names none). */
export async function resolveToken(kind: TokenKind, hash: string): Promise<{ token: Doc; artistId: string | null } | null> {
  const token = await db.get(systemCtx("resolve token"), kind, hash);
  if (!token || token.deletedAt) return null;
  return { token, artistId: typeof token.artistId === "string" && token.artistId ? token.artistId : null };
}
