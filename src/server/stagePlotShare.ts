/**
 * The engineer link for a stage plot: /plot/{id}/{token}. One stable link per plot, so the band can copy it from the show card any
 * time. The plain token lives only in stagePlotTokens/{plotId} (server-only: no Firestore rule reads it, written with the admin SDK
 * like routeCache). The plot itself keeps share.on and a SHA-256 hash of the token, which is what plotByToken checks. Turning the
 * link off deletes the token; turning it on again (or rotating) makes a new one.
 */
import { timingSafeEqual } from "node:crypto";
import { db, type Doc } from "./db";
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
export async function plotByToken(plotId: string, token: string): Promise<Doc> {
  const plot = await db.get("stagePlots", plotId);
  if (!plot || plot.deletedAt || !matches(plot, token)) throw new AppError("invalid_link", "This link is not valid any more. Ask the band for a new one.", 403);
  const { share: _share, ...rest } = plot;
  return rest as Doc;
}

const tokenDoc = (plotId: string) => firestore().collection("stagePlotTokens").doc(plotId);
export async function saveToken(plotId: string, token: string): Promise<void> { await tokenDoc(plotId).set({ token }); }
export async function readToken(plotId: string): Promise<string | null> { const s = await tokenDoc(plotId).get(); return s.exists ? ((s.data()!.token as string) ?? null) : null; }
export async function deleteToken(plotId: string): Promise<void> { await tokenDoc(plotId).delete(); }
