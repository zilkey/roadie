/**
 * Connecting the band's Instagram (Settings › Integrations), with Meta's Unified login. meta.connectUrl gives the dialog with
 * a signed state (this admin, this band); there the person logs in with Instagram or Facebook and picks the band's business
 * portfolio and Instagram account. Meta sends the browser to /api/meta/callback, which forwards code and state to the
 * Integrations page; the page calls meta.finishConnect as the signed-in admin. That trades the code for a token and reads
 * which Instagram account it's for, by token kind (src/server/meta/graph.ts, TokenKind):
 * - system-user token: debug_token for what was granted and its expiry, /me/assigned_instagram_accounts for the account;
 * - Instagram User token: exchanged for 60 days (renewed later, connection.ts), /me for the account.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { graph, GraphError, kindOf, metaAuthUrl, metaConfigured, NEEDED_PERMISSIONS, signMetaState, verifyMetaState, type TokenKind } from "../meta/graph";
import { freshToken, getConnection, removeConnection, saveConnection, type NewConnection } from "../meta/connection";

const artistOf = (ctx: Ctx) => {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
};
const configured = () => {
  if (!metaConfigured()) throw new AppError("meta_not_configured", "Instagram & Facebook aren't set up on this server", 503);
};

const PERMISSION_WORDS: Record<string, string> = {
  instagram_basic: "see the Instagram account", instagram_content_publish: "post to Instagram",
  instagram_business_basic: "see the Instagram account", instagram_business_content_publish: "post to Instagram",
};
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const NOT_PROFESSIONAL = "That Instagram is a personal account, and Instagram only lets apps post to professional ones. In the Instagram app, go to " +
  "Settings › Account type and tools › Switch to professional account (Business or Creator), then press Connect Instagram again.";
export const NO_ACCOUNT = "Meta didn't give Roadie an Instagram account. The band's Instagram has to be a professional account (Business or Creator) " +
  "in the band's business portfolio. Press Connect Instagram again, pick that portfolio, and tick the band's Instagram when Meta asks.";
export const several = (names: string[]) =>
  `Meta gave Roadie ${names.length} Instagram accounts (${and(names.map((n) => `@${n}`))}). Press Connect Instagram again and tick only the band's.`;
export const declined = (perms: string[]) =>
  `Meta didn't let Roadie ${and(perms.map((p) => PERMISSION_WORDS[p] ?? p))} (${perms.join(", ")}). Press Connect Instagram again and leave ${perms.length === 1 ? "it" : "them"} switched on.`;

/** Graph failures in plain words: a personal account says how to switch, anything else in Meta's own words. */
async function meta<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    if (e.code === 10 && /not business or creator/i.test(e.message)) throw new AppError("meta_not_professional", NOT_PROFESSIONAL, 400);
    throw new AppError("meta_error", `Instagram said: ${e.message}`, 502);
  }
}

const list = (v: string[] | string | undefined) => (Array.isArray(v) ? v : v ? v.split(",").map((x) => x.trim()) : undefined);
/** Refuse when a permission posting needs wasn't granted. Nothing to check when Meta doesn't say. */
function needs(kind: TokenKind, granted: string[] | undefined) {
  const missing = granted ? NEEDED_PERMISSIONS[kind].filter((p) => !granted.includes(p)) : [];
  if (missing.length) throw new AppError("meta_declined", declined(missing), 400);
}

/** What the code is for: the token, its kind and expiry, and the one Instagram account. */
async function connectionFor(code: string, now = Date.now()): Promise<NewConnection> {
  const got = await meta(graph.exchangeCode(code));
  const kind = kindOf(got.access_token);
  if (kind === "instagram") {
    needs(kind, list(got.permissions));
    const long = await meta(graph.longLived(got.access_token));
    const me = await meta(graph.igMe({ token: long.access_token, kind }));
    return { kind, token: long.access_token, instagram: { id: me.user_id ?? me.id, username: me.username }, businessId: null, expiresAt: new Date(now + long.expires_in * 1000) };
  }
  const t = { token: got.access_token, kind };
  const d = (await meta(graph.debugToken(t.token))).data;
  needs(kind, d.scopes);
  const accounts = (await meta(graph.assignedAccounts(t))).data;
  if (!accounts.length) throw new AppError("meta_no_account", NO_ACCOUNT, 400);
  if (accounts.length > 1) throw new AppError("meta_several_accounts", several(accounts.map((a) => a.username ?? a.id)), 400);
  const ig = accounts[0].username ? accounts[0] : await meta(graph.igUser(accounts[0].id, t));
  const businessId = (await graph.business(t).catch(() => null))?.client_business_id ?? null;
  return { kind, token: t.token, instagram: { id: ig.id, username: ig.username! }, businessId, expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null };
}

/** "Working" is asked of Instagram each time (renewing first when due): a revoked or expired token reads "Sign in again" with the reason. */
async function liveCheck(artistId: string): Promise<{ working: true; username: string } | { working: false; reason: string }> {
  try {
    const t = await freshToken(artistId);
    return { working: true, username: (await graph.igUser(t.igId, t)).username };
  } catch (e) {
    if (e instanceof GraphError) return { working: false, reason: e.message };
    if (e instanceof AppError && e.code === "meta_sign_in_again") return { working: false, reason: (e.data as { reason: string }).reason };
    throw e;
  }
}

async function status(ctx: Ctx) {
  const artistId = artistOf(ctx);
  if (!metaConfigured()) return { configured: false, connection: null, check: null };
  const check = (await getConnection(artistId)) ? await liveCheck(artistId) : null;
  return { configured: true, connection: await getConnection(artistId), check };
}

export const metaStatus = defineCommand({
  name: "meta.status", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: whether Instagram is set up on this server, the band's connected Instagram account (who connected it, and whether Roadie renews its sign-in or when it expires), and whether Instagram answers right now.",
  run: (ctx) => status(ctx),
});

export const metaConnectUrl = defineCommand({
  name: "meta.connectUrl", roles: ["admin"], input: z.strictObject({}),
  description: "Meta's sign-in dialog URL for connecting the band's Instagram (log in with Instagram or Facebook, pick the business portfolio and the account).",
  async run(ctx) {
    const artistId = artistOf(ctx);
    configured();
    const artist = await db.get("artists", artistId);
    if (!artist) throw new AppError("not_found", "Artist not found", 404);
    return { url: metaAuthUrl(signMetaState({ uid: ctx.uid, artistId, slug: artist.slug as string })) };
  },
});

export const metaFinishConnect = defineCommand({
  name: "meta.finishConnect", roles: ["admin"],
  description: "Finish connecting Instagram with the code Meta returned. The state must be one this admin started for this band. Stores the one Instagram account the person picked.",
  input: z.strictObject({ code: z.string().min(1), state: z.string().min(1) }),
  async run(ctx, { code, state }) {
    const artistId = artistOf(ctx);
    configured();
    const s = verifyMetaState(state);
    if (!s || s.uid !== ctx.uid || s.artistId !== artistId) throw new AppError("invalid_state", "That Instagram sign-in link has expired or isn't yours. Press Connect Instagram again.", 400);
    const c = await connectionFor(code);
    const user = await db.get("users", ctx.uid);
    await saveConnection(artistId, c, { uid: ctx.uid, name: (user?.name as string | undefined) ?? (user?.email as string | undefined) ?? "An admin" });
    return status(ctx);
  },
});

export const metaDisconnect = defineCommand({
  name: "meta.disconnect", roles: ["admin"], input: z.strictObject({}),
  description: "Disconnect the band's Instagram: forget the account and its sign-in. Posts already made stay on Instagram.",
  async run(ctx) {
    await removeConnection(artistOf(ctx));
    return status(ctx);
  },
});

export const metaCommands = [metaStatus, metaConnectUrl, metaFinishConnect, metaDisconnect];
