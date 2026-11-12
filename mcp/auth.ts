/** Bearer-token auth for the MCP server: sha256 the token, look it up in mcpTokens, check the user still has AI access. */
import { randomBytes } from "node:crypto";
import { hashToken } from "@/server/availability";
import { newRunId } from "@/server/ctx";
import type { Ctx } from "@/server/ctx";
import { db, touchLastUsed } from "@/server/db";
import { AppError } from "@/server/errors";
import { mcpIn, type Membership } from "@/schema/users";

export interface McpIdentity { uid: string; tokenHash: string; label: string; artistId: string }

export async function authenticateToken(raw: string | null | undefined): Promise<McpIdentity> {
  const token = raw?.trim();
  if (!token) throw new AppError("unauthenticated", "Missing bearer token", 401);
  const hash = hashToken(token);
  const t = await db.get("mcpTokens", hash);
  if (!t || t.deletedAt) throw new AppError("unauthenticated", "Unknown token", 401);
  if (t.revokedAt) throw new AppError("unauthenticated", "This token was revoked", 401);
  const u = await db.get("users", t.userId);
  if (!u || u.deletedAt || !(u.artists ?? []).some((x: Membership) => mcpIn(u, x.artistId))) throw new AppError("forbidden", "This user does not have AI access", 403);
  // The key works on one artist the person still belongs to (any role, "ai" included): the one it names, or their only one.
  const ms = (u.artists ?? []) as Membership[];
  const m = t.artistId ? ms.find((x) => x.artistId === t.artistId) : ms.length === 1 ? ms[0] : undefined;
  if (!m) throw new AppError("forbidden", t.artistId || !ms.length ? "This user is not a member of the key's artist" : "This key doesn't say which artist it is for", 403);
  if (!mcpIn(u, m.artistId)) throw new AppError("forbidden", "This user does not have AI access in this artist", 403);
  await touchLastUsed(hash);
  return { uid: u.id, tokenHash: hash, label: t.label, artistId: m.artistId };
}

/**
 * A new key for a person in one artist, made when a connector (Claude's app) finishes signing in. Their previous key from
 * the same client in that artist is revoked, so reconnecting doesn't pile up keys. Returns the raw key (stored hashed).
 */
export async function mintKey(userId: string, artistId: string, client: string): Promise<string> {
  const u = await db.get("users", userId);
  if (!u || u.deletedAt || !mcpIn(u, artistId)) throw new AppError("forbidden", "This user does not have AI access in this artist", 403);
  const ctx: Ctx = { uid: userId, role: "mcp", artistId, via: "mcp", runId: newRunId() };
  const mine = await db.list("mcpTokens", (q) => q.where("userId", "==", userId));
  for (const t of mine) if (t.artistId === artistId && t.client === client && !t.revokedAt) await db.update(ctx, "mcpTokens", t.id, { revokedAt: new Date() });
  const token = `btk_${randomBytes(32).toString("base64url")}`;
  await db.create(ctx, "mcpTokens", { userId, label: `${client} (signed in ${new Date().toISOString().slice(0, 10)})`, artistId, client }, { id: hashToken(token) });
  return token;
}

export const bearerOf = (header: string | string[] | null | undefined) => {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(.+)$/i.exec(h ?? "");
  return m ? m[1] : null;
};

export const mcpCtx = (id: McpIdentity, runId: string): Ctx => ({ uid: id.uid, role: "mcp", artistId: id.artistId, via: "mcp", runId });
