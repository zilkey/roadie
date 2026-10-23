/** Bearer-token auth for the MCP server: sha256 the token, look it up in mcpTokens, check the user still has AI access. */
import { hashToken } from "@/server/availability";
import type { Ctx } from "@/server/ctx";
import { db, touchLastUsed } from "@/server/db";
import { AppError } from "@/server/errors";

export interface McpIdentity { uid: string; tokenHash: string; label: string }

export async function authenticateToken(raw: string | null | undefined): Promise<McpIdentity> {
  const token = raw?.trim();
  if (!token) throw new AppError("unauthenticated", "Missing bearer token", 401);
  const hash = hashToken(token);
  const t = await db.get("mcpTokens", hash);
  if (!t || t.deletedAt) throw new AppError("unauthenticated", "Unknown token", 401);
  if (t.revokedAt) throw new AppError("unauthenticated", "This token was revoked", 401);
  const u = await db.get("users", t.userId);
  if (!u || u.deletedAt || !u.mcpAccess) throw new AppError("forbidden", "This user does not have AI access", 403);
  await touchLastUsed(hash);
  return { uid: u.id, tokenHash: hash, label: t.label };
}

export const bearerOf = (header: string | string[] | null | undefined) => {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(.+)$/i.exec(h ?? "");
  return m ? m[1] : null;
};

export const mcpCtx = (id: McpIdentity, runId: string): Ctx => ({ uid: id.uid, role: "mcp", via: "mcp", runId });
