"use client";
import { useEffect, useState } from "react";
import Link, { useZone } from "@/lib/artist";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import { celebratePost } from "@/components/Celebrate";
import { dateInZone, dateTimeInZone, fmtInstant } from "@/lib/timezone";
import { addDays } from "@/lib/pickShow";
import type { MetaStatus } from "@/components/posts/MetaCard";
import type { PostMedia } from "@/schema/posts";
import { isVideo, videoProblem } from "@/lib/photos";

interface Published { status: "posted" | "failed"; permalink?: string | null; error?: string; driveTidy?: { error: string } }
interface Scheduled { status: "scheduled"; scheduledAt: string }

/** Where Later starts: the post's scheduled time, else tomorrow at 6pm (band time). */
const startAt = (zone: string, scheduledAt?: string) => {
  if (scheduledAt) { const [date, time] = dateTimeInZone(zone, new Date(scheduledAt)).split(" "); return { date, time }; }
  return { date: addDays(dateInZone(zone), 1), time: "18:00" };
};

/**
 * Post it (the canvas's *Post it* board): the Instagram account it goes to (as one photo, a Reel or a carousel), a warning
 * when a photo has no alt text, a video outside Instagram's limits, what happens in Drive, and an explicit Post now (posts.publish). Off, with the connect or sign-in message, while Instagram isn't
 * connected or needs a new sign-in. Then *After posting*: the Instagram link and the folder's new name. `before` runs first
 * (the editor flushes its autosave). A successful post gets the confetti. *Later* schedules it instead (posts.schedule): a date
 * and time in the band's time zone, and it posts by itself then; a scheduled post opens on Later, at its time.
 */
export function PostDialog({ open, onClose, post, before }: {
  open: boolean; onClose(): void; before(): Promise<void>;
  post: { id: string; title?: string; media: PostMedia[]; scheduledAt?: string };
}) {
  const zone = useZone();
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [done, setDone] = useState<(Published & { folder: string }) | null>(null);
  const [scheduled, setScheduled] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState(() => startAt(zone, post.scheduledAt));
  const { call, error, busy, setError } = useCommand();
  useEffect(() => {
    if (!open) return;
    setDone(null); setScheduled(null); setError(null); setStatus(null);
    setLater(!!post.scheduledAt); setWhen(startAt(zone, post.scheduledAt));
    runCommand<MetaStatus>("meta.status", {}).then(setStatus, (e: Error) => setError(e.message));
  }, [open, setError, zone, post.scheduledAt]);

  const n = post.media.length;
  const title = post.title ?? "Post";
  const photos = post.media.filter((m) => !isVideo(m.mimeType)), videos = n - photos.length;
  const p = photos.length, noAlt = photos.filter((m) => !m.alt).length;
  const problems = post.media.map((m) => (isVideo(m.mimeType) ? videoProblem(m, n > 1) : null)).filter((x): x is string => !!x);
  const what = n === 1 ? (videos ? "A Reel" : "One photo")
    : !videos ? `A carousel of ${n} photos`
    : `A carousel of ${n}: ${p ? `${p} ${p === 1 ? "photo" : "photos"}, ` : ""}${videos} ${videos === 1 ? "video" : "videos"}`;
  const connected = status?.connection;
  const working = !!connected && !(status?.check && !status.check.working);

  async function go() {
    await before();
    const r = await call<Published>("posts.publish", { id: post.id });
    if (r?.status === "failed") { setError(`Didn't post: ${r.error ?? "Instagram didn't say why."}`); return; }
    if (r) { setDone({ ...r, folder: `${dateInZone(zone)} - ${title}` }); celebratePost(title); }
  }

  async function schedule() {
    await before();
    const r = await call<Scheduled>("posts.schedule", { id: post.id, at: `${when.date} ${when.time}` });
    if (r) setScheduled(r.scheduledAt);
  }

  return (
    <Dialog open={open} onClose={onClose} title={done ? "Posted" : scheduled ? "Scheduled" : "Post it"} testid="post-dialog">
      {scheduled ? (
        <div className="grid gap-3" data-testid="post-scheduled">
          <p className="m-0">It posts to Instagram by itself on <b data-testid="post-scheduled-at">{fmtInstant(scheduled, zone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>. You can keep editing it until then.</p>
          <p className="s m-0">If it can&apos;t post then, you&apos;ll get an email and it shows as Didn&apos;t post on Posts.</p>
          <div className="flex justify-end"><Link href="/posts" className="btn" data-testid="post-scheduled-close">Back to Posts</Link></div>
        </div>
      ) : done ? (
        <div className="grid gap-3" data-testid="post-done">
          {done.permalink
            ? <p className="m-0"><a href={done.permalink} target="_blank" rel="noreferrer" className="underline" data-testid="post-done-permalink">View on Instagram ›</a></p>
            : <p className="m-0">It&apos;s on Instagram.</p>}
          {done.driveTidy
            ? <p className="err m-0" data-testid="post-done-tidy">Drive wasn&apos;t tidied: {done.driveTidy.error}. Use Finish tidying Drive on Posts.</p>
            : <p className="m-0" data-testid="post-done-folder">In Drive, its folder is now <b>Posts/{done.folder}</b>.</p>}
          <div className="flex justify-end"><Link href="/posts" className="btn" data-testid="post-done-close">Back to Posts</Link></div>
        </div>
      ) : (
        <div className="grid gap-3">
          {!status ? (!error && <p className="s m-0">Checking Instagram…</p>) : !connected ? (
            <p className="m-0" data-testid="post-not-connected">Instagram isn&apos;t connected. <Link href="/admin/mcp" className="underline">Connect it in Settings › Integrations</Link>.</p>
          ) : !working ? (
            <p className="err m-0" data-testid="post-sign-in-again">Sign in again: {status.check && !status.check.working ? status.check.reason : ""} <Link href="/admin/mcp" className="underline">Connect again in Settings › Integrations</Link>.</p>
          ) : (
            <p className="m-0" data-testid="post-account">{what} goes to <b>@{connected.instagram.username}</b> {later ? "at the time below" : "now"}.</p>
          )}
          <div className="flex gap-2" role="group" aria-label="When">
            <button type="button" className={`btn sm ${later ? "ghost" : ""}`} aria-pressed={!later} onClick={() => setLater(false)} data-testid="post-when-now">Now</button>
            <button type="button" className={`btn sm ${later ? "" : "ghost"}`} aria-pressed={later} onClick={() => setLater(true)} data-testid="post-when-later">Later</button>
          </div>
          {later && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1"><span className="s">Date</span>
                <input type="date" className="input" value={when.date} min={dateInZone(zone)} onChange={(e) => setWhen({ ...when, date: e.target.value })} data-testid="post-schedule-date" /></label>
              <label className="grid gap-1"><span className="s">Time</span>
                <input type="time" className="input" value={when.time} onChange={(e) => setWhen({ ...when, time: e.target.value })} data-testid="post-schedule-time" /></label>
            </div>
          )}
          {problems.map((why) => <p key={why} className="err m-0" data-testid="post-video-problem">{why}</p>)}
          {videos > 0 && !later && <p className="s m-0" data-testid="post-video-note">Instagram takes a little while to process a video; Posting… can take up to a minute.</p>}
          {noAlt > 0 && (
            <p className="s m-0" data-testid="post-no-alt">
              {noAlt === p ? (p === 1 ? "The photo has no alt text." : "None of the photos have alt text.") : `${noAlt} of the ${p} photos have no alt text.`}{" "}
              People using screen readers won&apos;t know what&apos;s in {noAlt === 1 ? "it" : "them"}.
            </p>
          )}
          <p className="s m-0" data-testid="post-drive-note">
            In Drive, <b>Posts/DRAFT - {title}</b> becomes <b>Posts/{later ? when.date || dateInZone(zone) : dateInZone(zone)} - {title}</b>{later ? " once it posts" : ""}. If Instagram refuses it, nothing in Drive changes.
          </p>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy} data-testid="post-cancel">Cancel</button>
            {later ? (
              <button type="button" className="btn" disabled={busy || !working || problems.length > 0 || !when.date || !when.time} onClick={() => void schedule()} data-testid="post-schedule">
                {busy ? "Scheduling…" : post.scheduledAt ? "Change time" : "Schedule"}
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy || !working || problems.length > 0} onClick={() => void go()} data-testid="post-now">
                {busy ? "Posting…" : "Post now"}
              </button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
