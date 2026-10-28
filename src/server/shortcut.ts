/**
 * The iOS Shortcut ("Send to Roadie"): share a voice memo, pick the rehearsal and the songs, and it lands in Drive and
 * on the rehearsal like an upload from the app. The Shortcut can't sign in, so it carries a long-lived token (rsk_…) that an
 * admin makes on Settings > Google and types into the Shortcut when installing it. Tokens are stored hashed in
 * shortcutTokens (sha256, like MCP keys); one live token per admin per artist. The routes are under /api/shortcut.
 */
import { randomBytes } from "node:crypto";
import { hashToken } from "./availability";
import { newRunId, type Ctx } from "./ctx";
import { db, touchLastUsed } from "./db";
import { AppError } from "./errors";
import type { Membership } from "@/schema/users";

export const SHORTCUT_PREFIX = "rsk_";
export const isShortcutToken = (raw: string | null | undefined) => !!raw && raw.trim().startsWith(SHORTCUT_PREFIX);

/** A new token for this admin in this artist; their previous live one is revoked. The raw token is returned once. */
export async function createShortcutToken(ctx: Ctx): Promise<{ token: string; id: string }> {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  await revokeShortcutTokens(ctx);
  const token = `${SHORTCUT_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = hashToken(token);
  await db.create(ctx, "shortcutTokens", { userId: ctx.uid, artistId: ctx.artistId }, { id });
  return { token, id };
}

/** The caller's live token in this artist, if any. */
export async function liveShortcutToken(ctx: Ctx) {
  return (await liveTokens(ctx)).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0] ?? null;
}
/** One where() only (no composite index needed); the artist is filtered here. */
async function liveTokens(ctx: Ctx) {
  const mine = await db.list("shortcutTokens", (q) => q.where("userId", "==", ctx.uid));
  return mine.filter((t) => t.artistId === ctx.artistId && !t.revokedAt);
}

/** Revoke every live token of the caller in this artist. */
export async function revokeShortcutTokens(ctx: Ctx): Promise<number> {
  let n = 0;
  for (const t of await liveTokens(ctx)) { await db.update(ctx, "shortcutTokens", t.id, { revokedAt: new Date() }); n++; }
  return n;
}

/**
 * An error as the Shortcut routes answer it: the usual `error: { code, message }` plus `ok: false` and a top-level
 * `message` ("Upload failed: …") that the Shortcut shows in a notification with one Get Dictionary Value.
 * Unknown errors are logged and answered as 500 without their details.
 */
export function shortcutErrorResponse(e: unknown, prefix: string): Response {
  const err = e instanceof AppError ? e : (console.error(e), new AppError("internal", "Something went wrong", 500));
  return Response.json({ ok: false, message: `${prefix}: ${err.message}`, ...err.toJSON() }, { status: err.status });
}

/** The request context for a shortcut token: the admin who made it, in the artist it was made for. */
export async function authenticateShortcut(raw: string | null | undefined): Promise<Ctx> {
  const token = raw?.trim();
  if (!token) throw new AppError("unauthenticated", "Missing bearer token", 401);
  const hash = hashToken(token);
  const t = await db.get("shortcutTokens", hash);
  if (!t || t.deletedAt) throw new AppError("unauthenticated", "Unknown token. Make a new one on Settings > Google and update the Shortcut.", 401);
  if (t.revokedAt) throw new AppError("unauthenticated", "This token was replaced or revoked. Make a new one on Settings > Google and update the Shortcut.", 401);
  const u = await db.get("users", t.userId);
  if (!u || u.deletedAt) throw new AppError("forbidden", "Account is not active", 403);
  const m = ((u.artists ?? []) as Membership[]).find((x) => x.artistId === t.artistId);
  if (!m || m.role !== "admin") throw new AppError("forbidden", "Only admins can add recordings", 403);
  await touchLastUsed(hash, new Date(), "shortcutTokens");
  return { uid: u.id, role: "admin", artistId: t.artistId as string, musicianId: u.musicianId as string | undefined, via: "shortcut", runId: newRunId() };
}
