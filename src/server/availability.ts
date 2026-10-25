/** Availability link tokens: random, shown once (in the email), stored only as a SHA-256 hash in linkTokens. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { run, db, type Doc } from "./db";
import { AppError } from "./errors";
import { newRunId, type Ctx } from "./ctx";
import { appUrl } from "@/lib/app-url";
export { appUrl };

export const newToken = () => randomBytes(24).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const answerLink = (availabilityId: string, musicianId: string, token: string) =>
  `${appUrl()}/ask/${encodeURIComponent(availabilityId)}/${encodeURIComponent(musicianId)}/${token}`;

function matches(av: Doc, musicianId: string, token: string): boolean {
  const stored = (av.linkTokens ?? {})[musicianId];
  if (!stored || !token) return false;
  const a = Buffer.from(hashToken(token)), b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function verified(availabilityId: string, musicianId: string, token: string): Promise<Doc> {
  const av = await db.get("availability", availabilityId);
  // Same error for "no such ask" and "wrong token" so links cannot be probed.
  if (!av || av.deletedAt || !matches(av, musicianId, token)) throw new AppError("invalid_link", "This link is not valid any more. Ask the band for a new one.", 403);
  return av;
}

export interface LinkAsk { availabilityId: string; date: string; label: string; closed: boolean; answer?: "yes" | "no" | "maybe"; note?: string }
export interface LinkView extends LinkAsk {
  musicianId: string; musicianName: string; askedBy: string;
  /** Every date this link answers, in date order: one ask about several dates stores the same token on each date's doc. */
  asks: LinkAsk[];
}

const linkAsk = (av: Doc, musicianId: string): LinkAsk => {
  const r = av.responses?.[musicianId];
  return { availabilityId: av.id, date: av.date, label: av.label, closed: !!av.closedAt, answer: r?.answer, note: r?.note };
};

/** What the public answer page shows. Reveals nothing about other people's answers. */
export async function viewByToken(availabilityId: string, musicianId: string, token: string): Promise<LinkView> {
  const av = await verified(availabilityId, musicianId, token);
  const [m, u] = await Promise.all([db.get("musicians", musicianId), db.get("users", av.createdBy)]);
  const scope = av.pitchId ? "pitchId" : av.showId ? "showId" : null;
  const same = scope ? await db.list("availability", (q) => q.where(scope, "==", av[scope])) : [av];
  const asks = same.filter((x) => matches(x, musicianId, token)).sort((a, b) => a.date.localeCompare(b.date)).map((x) => linkAsk(x, musicianId));
  return { ...linkAsk(av, musicianId), musicianId, musicianName: m?.name ?? "", askedBy: u?.name ?? "the band", asks };
}

export async function answerByToken(availabilityId: string, musicianId: string, token: string, answer: "yes" | "no" | "maybe", note?: string) {
  await verified(availabilityId, musicianId, token);
  const ctx: Ctx = { uid: `link:${musicianId}`, role: "member", musicianId, via: "app", runId: newRunId() };
  return run(ctx, async (w) => {
    const av = await w.get("availability", availabilityId);
    if (!av || av.deletedAt) throw new AppError("not_found", "Not found", 404);
    if (av.closedAt) throw new AppError("closed", "This question is closed.", 409);
    return w.update("availability", availabilityId, {
      responses: { ...av.responses, [musicianId]: { answer, ...(note?.trim() ? { note: note.trim() } : {}), by: "self", at: w.now } },
    });
  });
}
