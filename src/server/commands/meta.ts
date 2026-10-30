/**
 * Connecting the band's Instagram & Facebook (Settings › Integrations). meta.connectUrl gives Facebook's sign-in dialog with a
 * signed state (this admin, this band); Facebook sends the browser to /api/meta/callback, which forwards code and state to
 * the Integrations page; the page calls meta.finishConnect as the signed-in admin. That trades the code for a long-lived user
 * token, reads the granted Pages with it (their Page tokens then never expire), takes the one with a linked Instagram (or asks
 * which, meta.choosePage), checks with debug_token that the Page token never expires, and stores it (src/server/meta).
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { graph, GraphError, metaAuthUrl, metaConfigured, NEEDED_PERMISSIONS, signMetaState, verifyMetaState } from "../meta/graph";
import { clearPending, getConnection, pageToken, pendingFor, removeConnection, saveConnection, savePending, takePending, type PageChoice } from "../meta/connection";

const artistOf = (ctx: Ctx) => {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
};
const configured = () => {
  if (!metaConfigured()) throw new AppError("meta_not_configured", "Instagram & Facebook aren't set up on this server", 503);
};

/** Graph failures in Facebook's words. */
async function fb<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (e instanceof GraphError) throw new AppError("meta_error", `Facebook: ${e.message}`, 502);
    throw e;
  }
}

const PERMISSION_WORDS: Record<string, string> = {
  pages_show_list: "see your Pages", pages_read_engagement: "read the Page", instagram_basic: "see the Instagram account",
  instagram_content_publish: "post to Instagram",
};
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const NO_PAGE = "Facebook didn't give Roadie a Page. Press Connect with Facebook again, and pick the band's Page when Facebook asks.";
export const noInstagram = (pages: string[]) =>
  `${pages.length === 1 ? pages[0] : and(pages)} ${pages.length === 1 ? "has" : "have"} no Instagram Professional account linked. In the Instagram app, go to ` +
  "Settings › Account type and tools › Switch to professional account (Business or Creator), then link it to the band's Facebook Page " +
  "(on the Page: Settings › Linked accounts › Instagram). Then press Connect with Facebook again.";
export const declined = (perms: string[]) =>
  `Facebook didn't let Roadie ${and(perms.map((p) => PERMISSION_WORDS[p] ?? p))} (${perms.join(", ")}). Press Connect with Facebook again and leave ${perms.length === 1 ? "it" : "them"} switched on.`;

/** Store the chosen Page once debug_token says its token never expires. */
async function keep(ctx: Ctx, artistId: string, c: PageChoice & { token: string }) {
  const d = await fb(graph.debugToken(c.token));
  if (d.data.expires_at !== 0) throw new AppError("meta_token_expires", "Facebook gave Roadie a Page sign-in that expires. Press Connect with Facebook again.", 502);
  const user = await db.get("users", ctx.uid);
  await saveConnection(artistId, c, { uid: ctx.uid, name: (user?.name as string | undefined) ?? (user?.email as string | undefined) ?? "An admin" });
}

/** "Working" is asked of Instagram each time: a revoked token or a changed password reads "Sign in again" with Facebook's reason. */
async function liveCheck(artistId: string): Promise<{ working: true; username: string } | { working: false; reason: string }> {
  const { token, igId } = await pageToken(artistId);
  try { return { working: true, username: (await graph.igUser(igId, token)).username }; } catch (e) {
    if (e instanceof GraphError) return { working: false, reason: e.message };
    throw e;
  }
}

async function status(ctx: Ctx) {
  const artistId = artistOf(ctx);
  if (!metaConfigured()) return { configured: false, connection: null, check: null, choose: null };
  const [connection, choose] = await Promise.all([getConnection(artistId), pendingFor(artistId, ctx.uid)]);
  return { configured: true, connection, check: connection ? await liveCheck(artistId) : null, choose };
}

export const metaStatus = defineCommand({
  name: "meta.status", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: whether Instagram & Facebook are set up on this server, the band's connected Page and Instagram (and who connected them), whether Instagram answers right now, and any Pages waiting to be picked.",
  run: (ctx) => status(ctx),
});

export const metaConnectUrl = defineCommand({
  name: "meta.connectUrl", roles: ["admin"], input: z.strictObject({}),
  description: "Facebook's sign-in dialog URL for connecting the band's Facebook Page and its Instagram.",
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
  description: "Finish connecting Instagram & Facebook with the code Facebook returned. The state must be one this admin started for this band. " +
    "Stores the Page when exactly one has a linked Instagram; with several, returns them to choose from (meta.choosePage).",
  input: z.strictObject({ code: z.string().min(1), state: z.string().min(1) }),
  async run(ctx, { code, state }) {
    const artistId = artistOf(ctx);
    configured();
    const s = verifyMetaState(state);
    if (!s || s.uid !== ctx.uid || s.artistId !== artistId) throw new AppError("invalid_state", "That Facebook sign-in link has expired or isn't yours. Press Connect with Facebook again.", 400);
    const short = await fb(graph.exchangeCode(code));
    const user = (await fb(graph.longLived(short.access_token))).access_token;
    const perms = (await fb(graph.permissions(user))).data;
    const missing = NEEDED_PERMISSIONS.filter((p) => !perms.some((x) => x.permission === p && x.status === "granted"));
    if (missing.length) throw new AppError("meta_declined", declined(missing), 400);
    const pages = (await fb(graph.pages(user))).data;
    if (!pages.length) throw new AppError("meta_no_page", NO_PAGE, 400);
    const usable = pages.filter((p) => p.instagram_business_account?.id).map((p) => ({
      pageId: p.id, pageName: p.name, igId: p.instagram_business_account!.id, igUsername: p.instagram_business_account!.username ?? "", token: p.access_token,
    }));
    if (!usable.length) throw new AppError("meta_no_instagram", noInstagram(pages.map((p) => p.name)), 400);
    if (usable.length > 1) {
      await savePending(artistId, ctx.uid, usable);
      return status(ctx);
    }
    await keep(ctx, artistId, usable[0]);
    return status(ctx);
  },
});

export const metaChoosePage = defineCommand({
  name: "meta.choosePage", roles: ["admin"],
  description: "Pick which of the Pages from meta.finishConnect (each with a linked Instagram) is the band's, and store it.",
  input: z.strictObject({ pageId: z.string().min(1) }),
  async run(ctx, { pageId }) {
    const artistId = artistOf(ctx);
    configured();
    await keep(ctx, artistId, await takePending(artistId, ctx.uid, pageId));
    return status(ctx);
  },
});

export const metaCancelChoice = defineCommand({
  name: "meta.cancelChoice", roles: ["admin"], input: z.strictObject({}),
  description: "Forget the Pages waiting to be picked; any connection there was stays as it is.",
  async run(ctx) {
    await clearPending(artistOf(ctx));
    return status(ctx);
  },
});

export const metaDisconnect = defineCommand({
  name: "meta.disconnect", roles: ["admin"], input: z.strictObject({}),
  description: "Disconnect the band's Instagram & Facebook: forget the Page and its sign-in. Posts already made stay on Instagram.",
  async run(ctx) {
    await removeConnection(artistOf(ctx));
    return status(ctx);
  },
});

export const metaCommands = [metaStatus, metaConnectUrl, metaFinishConnect, metaChoosePage, metaCancelChoice, metaDisconnect];
