/**
 * The engineer link for a stage plot: /plot/{id}/{token}. One stable link per plot, so the band can copy it from the show card any
 * time. The plain token lives only in stagePlotTokens/{plotId} (server-only: no Firestore rule reads it, written with the admin SDK
 * like routeCache). The plot itself keeps share.on and a SHA-256 hash of the token, which is what plotByToken checks. Turning the
 * link off deletes the token; turning it on again (or rotating) makes a new one.
 */
import { timingSafeEqual } from "node:crypto";
import { db, type Doc } from "./db";
import { artistCtx, systemCtx, type Ctx } from "./ctx";
import { firestore } from "./admin";
import { AppError } from "./errors";
import { appUrl, hashToken, newToken } from "./availability";

export { newToken };
export const plotLink = (plotId: string, token: string) => `${appUrl()}/plot/${encodeURIComponent(plotId)}/${token}`;

function matches(plot: Doc, token: string): boolean {
  const stored = plot.share?.on ? plot.share.tokenHash : undefined;
  if (!stored || !token) return false;
  const a = Buffer.from(hashToken(token)), b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The plot a valid, switched-on link points at, without the stored hash. Same error for "no such plot", "link off" and "wrong token" so links cannot be probed. */
export async function plotByToken(ctx: Ctx, plotId: string, token: string): Promise<Doc> {
  const plot = await db.get(ctx, "stagePlots", plotId);
  if (!plot || plot.deletedAt || !matches(plot, token)) throw new AppError("invalid_link", "This link is not valid any more. Ask the band for a new one.", 403);
  const { share: _share, ...rest } = plot;
  return rest as Doc;
}

const tokenDoc = (plotId: string) => firestore().collection("stagePlotTokens").doc(plotId);
/** The token doc keeps the plot's artist, so a public link can find whose plot it is before it has a ctx. */
export async function saveToken(ctx: Ctx, plotId: string, token: string): Promise<void> { await tokenDoc(plotId).set({ token, artistId: ctx.artistId }); }
/**
 * Whose plot a link is for (the route builds that artist's ctx from it, then calls plotByToken). A token saved before tenancy
 * phase 4 names no artist: the plot's own is read through the system view (the plot token check is allow-listed). Same error as
 * plotByToken for an unknown link.
 */
export async function plotTokenArtist(plotId: string): Promise<string> {
  const s = await tokenDoc(plotId).get();
  const artistId = s.exists ? ((s.data()!.artistId as string | undefined) ?? ((await db.get(systemCtx("plot link"), "stagePlots", plotId))?.artistId as string | undefined)) : undefined;
  if (!artistId) throw new AppError("invalid_link", "This link is not valid any more. Ask the band for a new one.", 403);
  return artistId;
}

/** The plot behind a public link, and a ctx for its artist (tenancy plan D3: the plot's artistId, after the token check). */
export async function publicPlot(plotId: string, token: string): Promise<{ ctx: Ctx; plot: Doc }> {
  const ctx = artistCtx({ uid: "plot-link", role: "member", artistId: await plotTokenArtist(plotId), via: "app" });
  return { ctx, plot: await plotByToken(ctx, plotId, token) };
}
export async function readToken(plotId: string): Promise<string | null> { const s = await tokenDoc(plotId).get(); return s.exists ? ((s.data()!.token as string) ?? null) : null; }
export async function deleteToken(plotId: string): Promise<void> { await tokenDoc(plotId).delete(); }
