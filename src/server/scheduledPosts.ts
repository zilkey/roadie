/**
 * Scheduled posts: Cloud Scheduler calls /api/cron/posts every minute, and each call posts every band's scheduled posts whose
 * time has come (posts.schedule), the soonest first, a few at a time in parallel. Each runs posts.publish exactly as the person
 * who scheduled it would (their uid, as an admin), so History and the post read the same as posting it by hand.
 *
 * What happens next:
 * - posted: done.
 * - Instagram still processing a video, or a passing error (Drive, the network): back to scheduled, so the next minute picks
 *   it up where it left off (Post.pending), up to MAX_TRIES; then failed.
 * - Instagram refused it, the sign-in has run out, or the person isn't an admin any more: failed at once.
 * A post that ends up failed emails whoever scheduled it (from the band's booking mailbox, else their own Gmail), and Posts shows
 * it as Didn't post. Two calls never post the same post: posts.publish claims it (status publishing) in a transaction.
 */
import { artistCtx, systemCtx, type Ctx } from "./ctx";
import { db } from "./db";
import { AppError } from "./errors";
import { GraphError } from "./meta/graph";
import { postsPublish } from "./commands/posts";
import { accountOf } from "./commands/email";
import { gmailClient } from "./integrations";
import { zoneOf } from "./zone";
import { appUrl } from "@/lib/app-url";
import { fmtInstant } from "@/lib/timezone";
import type { Membership } from "@/schema/users";
import type { Via } from "@/schema/common";

/** Tries before a post that keeps being told "try again" is marked failed: about ten minutes. */
export const MAX_TRIES = 10;
/** At most this many posts go out per call (each can wait ~45 seconds on Instagram, so they run side by side). */
export const PER_CALL = 5;

export interface ScheduledResult { artistId: string; id: string; outcome: "posted" | "retry" | "failed"; error?: string; emailed?: boolean }

type Due = { id: string; artistId: string; title?: string; scheduledAt: string; scheduledBy?: string; scheduledVia?: Via; scheduleTries?: number };

/** Every band's scheduled posts whose time has come, soonest first. */
export async function duePosts(now = new Date()): Promise<Due[]> {
  const rows = await db.list(systemCtx("scheduled posts"), "posts", (q) => q.where("status", "==", "scheduled"));
  return (rows as unknown as Due[])
    .filter((p) => p.scheduledAt && Date.parse(p.scheduledAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
}

/** Post what's due: at most PER_CALL, side by side. */
export async function publishDue(now = new Date()): Promise<{ due: number; results: ScheduledResult[] }> {
  const due = await duePosts(now);
  const results = await Promise.all(due.slice(0, PER_CALL).map((p) => publishOne(p)));
  return { due: due.length, results };
}

/** The scheduler's ctx in the post's band: an admin there (or with AI access), else null. */
async function schedulerCtx(p: Due): Promise<Ctx | null> {
  if (!p.scheduledBy) return null;
  const user = await db.get(systemCtx("scheduled posts"), "users", p.scheduledBy);
  const m = ((user?.artists ?? []) as Membership[]).find((x) => x.artistId === p.artistId);
  if (!user || user.deletedAt || !m || (m.role !== "admin" && m.role !== "ai")) return null;
  return artistCtx({ uid: p.scheduledBy, role: "admin", via: p.scheduledVia ?? "app", artistId: p.artistId, ...(m.musicianId ? { musicianId: m.musicianId } : {}) });
}

async function publishOne(p: Due): Promise<ScheduledResult> {
  const base = { artistId: p.artistId, id: p.id };
  const ctx = await schedulerCtx(p);
  if (!ctx) {
    // Nobody to post it as: failed, and no one to email (the band sees it on Posts).
    const error = "Whoever scheduled it isn't an admin of the band any more. Schedule it again, or post it now";
    await db.update(artistCtx({ uid: "scheduler", role: "admin", via: "app", artistId: p.artistId }), "posts", p.id, { status: "failed", error });
    return { ...base, outcome: "failed", error };
  }
  const tries = (p.scheduleTries ?? 0) + 1;
  let error: string, retry: boolean;
  try {
    const r = (await postsPublish.run(ctx, { id: p.id })) as { status: "posted" | "failed"; error?: string; processing?: boolean };
    if (r.status === "posted") return { ...base, outcome: "posted" };
    error = r.error ?? "Instagram didn't say why";
    retry = r.processing === true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    // Roadie's own refusals (signed out, not there, being posted) and Instagram's answers are final; anything else may pass.
    retry = !(e instanceof AppError) && !(e instanceof GraphError);
    if (e instanceof AppError && e.code === "post_locked") return { ...base, outcome: "retry", error }; // another call has it
    if (e instanceof AppError && e.code === "not_found") return { ...base, outcome: "failed", error };
  }
  if (retry && tries < MAX_TRIES) {
    await db.update(ctx, "posts", p.id, { status: "scheduled", scheduleTries: tries });
    return { ...base, outcome: "retry", error };
  }
  await db.update(ctx, "posts", p.id, { status: "failed", error, scheduleTries: tries });
  return { ...base, outcome: "failed", error, emailed: await emailFailure(ctx, p, error) };
}

/** "Didn't post: <title>" to whoever scheduled it. Never throws: false (and a log line) when it couldn't be sent. */
async function emailFailure(ctx: Ctx, p: Due, error: string): Promise<boolean> {
  try {
    const [user, artist, zone] = await Promise.all([db.get(ctx, "users", ctx.uid), db.get(ctx, "artists", ctx.artistId), zoneOf(ctx)]);
    const to = String(user?.email ?? "");
    if (!to) return false;
    const title = p.title ?? "Your post";
    const link = artist?.slug ? `${appUrl()}/artists/${artist.slug}/posts/${p.id}` : `${appUrl()}/artists`;
    const body = [
      `Roadie couldn't post ${title} to Instagram at ${fmtInstant(p.scheduledAt, zone)}.`,
      "",
      error,
      "",
      `It's on Posts as Didn't post. Open it to post it now or pick a new time: ${link}`,
    ].join("\n");
    await gmailClient().send({ account: await accountOf(ctx), to: [to], subject: `Didn't post: ${title}`, body });
    return true;
  } catch (e) {
    console.warn(JSON.stringify({ event: "posts.scheduledFailureEmail", artistId: ctx.artistId, id: p.id, sent: false, reason: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
