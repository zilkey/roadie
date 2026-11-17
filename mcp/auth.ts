/** Bearer-token auth for the MCP server: sha256 the token, look it up in mcpTokens, check the user still has AI access. */
import { randomBytes } from "node:crypto";
import { hashToken } from "@/server/availability";
import { artistCtx, systemCtx } from "@/server/ctx";
import type { Ctx } from "@/server/ctx";
import { db, touchLastUsed } from "@/server/db";
import { resolveToken } from "@/server/tokens";
import { AppError } from "@/server/errors";
import { mcpIn, type Membership } from "@/schema/users";

export interface McpIdentity { uid: string; tokenHash: string; label: string; artistId: string; artistName: string }

export async function authenticateToken(raw: string | null | undefined): Promise<McpIdentity> {
  const token = raw?.trim();
  if (!token) throw new AppError("unauthenticated", "Missing bearer token", 401);
  const hash = hashToken(token);
  const found = await resolveToken("mcpTokens", hash);
  if (!found) throw new AppError("unauthenticated", "Unknown token", 401);
  const t = found.token;
  if (t.revokedAt) throw new AppError("unauthenticated", "This token was revoked", 401);
  const u = await db.get(systemCtx("mcp token"), "users", t.userId);
  if (!u || u.deletedAt || !(u.artists ?? []).some((x: Membership) => mcpIn(u, x.artistId))) throw new AppError("forbidden", "This user does not have AI access", 403);
  // The key works on the one artist it names, while the person still belongs to it (any role, "ai" included).
  if (!found.artistId) throw new AppError("forbidden", "This key doesn't say which artist it is for. Make a new one.", 403);
  const ms = (u.artists ?? []) as Membership[];
  const m = ms.find((x) => x.artistId === found.artistId);
  if (!m) throw new AppError("forbidden", "This user is not a member of the key's artist", 403);
  if (!mcpIn(u, m.artistId)) throw new AppError("forbidden", "This user does not have AI access in this artist", 403);
  const artist = await db.get(systemCtx("mcp token"), "artists", m.artistId);
  if (!artist || artist.deletedAt) throw new AppError("forbidden", "This key's artist is gone", 403);
  await touchLastUsed(hash);
  return { uid: u.id, tokenHash: hash, label: t.label, artistId: m.artistId, artistName: artist.name as string };
}

/**
 * A new key for a person in one artist, made when a connector (Claude's app) finishes signing in. Their previous key from
 * the same client in that artist is revoked, so reconnecting doesn't pile up keys. Returns the raw key (stored hashed).
 */
export async function mintKey(userId: string, artistId: string, client: string): Promise<string> {
  const u = await db.get(systemCtx("mcp key"), "users", userId);
  if (!u || u.deletedAt || !mcpIn(u, artistId)) throw new AppError("forbidden", "This user does not have AI access in this artist", 403);
  const ctx = artistCtx({ uid: userId, role: "mcp", artistId, via: "mcp" });
  const mine = await db.list(ctx, "mcpTokens", (q) => q.where("userId", "==", userId));
  for (const t of mine) if (t.client === client && !t.revokedAt) await db.update(ctx, "mcpTokens", t.id, { revokedAt: new Date() });
  const token = `btk_${randomBytes(32).toString("base64url")}`;
  await db.create(ctx, "mcpTokens", { userId, label: `${client} (signed in ${new Date().toISOString().slice(0, 10)})`, artistId, client }, { id: hashToken(token) });
  return token;
}

export const bearerOf = (header: string | string[] | null | undefined) => {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(.+)$/i.exec(h ?? "");
  return m ? m[1] : null;
};

export const mcpCtx = (id: McpIdentity, runId: string): Ctx => artistCtx({ uid: id.uid, role: "mcp", artistId: id.artistId, via: "mcp", runId });
