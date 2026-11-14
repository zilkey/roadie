"use client";
import { useEffect, useState } from "react";
import Link from "@/lib/artist";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import { celebratePost } from "@/components/Celebrate";
import { dateInBandZone } from "@/lib/timezone";
import type { MetaStatus } from "@/components/posts/MetaCard";
import type { PostMedia } from "@/schema/posts";
import { isVideo, videoProblem } from "@/lib/photos";

interface Published { status: "posted" | "failed"; permalink?: string | null; error?: string; driveTidy?: { error: string } }

/**
 * Post it (the canvas's *Post it* board): the Instagram account it goes to (as one photo, a Reel or a carousel), a warning
 * when a photo has no alt text, a video outside Instagram's limits, what happens in Drive, and an explicit Post now (posts.publish). Off, with the connect or sign-in message, while Instagram isn't
 * connected or needs a new sign-in. Then *After posting*: the Instagram link and the folder's new name. `before` runs first
 * (the editor flushes its autosave). A successful post gets the confetti.
 */
export function PostDialog({ open, onClose, post, before }: {
  open: boolean; onClose(): void; before(): Promise<void>;
  post: { id: string; title?: string; media: PostMedia[] };
}) {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [done, setDone] = useState<(Published & { folder: string }) | null>(null);
  const { call, error, busy, setError } = useCommand();
  useEffect(() => {
    if (!open) return;
    setDone(null); setError(null); setStatus(null);
    runCommand<MetaStatus>("meta.status", {}).then(setStatus, (e: Error) => setError(e.message));
  }, [open, setError]);

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
    if (r) { setDone({ ...r, folder: `${dateInBandZone()} - ${title}` }); celebratePost(title); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={done ? "Posted" : "Post it"} testid="post-dialog">
      {done ? (
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
            <p className="m-0" data-testid="post-account">{what} goes to <b>@{connected.instagram.username}</b> now.</p>
          )}
          {problems.map((why) => <p key={why} className="err m-0" data-testid="post-video-problem">{why}</p>)}
          {videos > 0 && <p className="s m-0" data-testid="post-video-note">Instagram takes a little while to process a video; Posting… can take up to a minute.</p>}
          {noAlt > 0 && (
            <p className="s m-0" data-testid="post-no-alt">
              {noAlt === p ? (p === 1 ? "The photo has no alt text." : "None of the photos have alt text.") : `${noAlt} of the ${p} photos have no alt text.`}{" "}
              People using screen readers won&apos;t know what&apos;s in {noAlt === 1 ? "it" : "them"}.
            </p>
          )}
          <p className="s m-0" data-testid="post-drive-note">
            In Drive, <b>Posts/DRAFT - {title}</b> becomes <b>Posts/{dateInBandZone()} - {title}</b>. If Instagram refuses it, nothing in Drive changes.
          </p>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy} data-testid="post-cancel">Cancel</button>
            <button type="button" className="btn" disabled={busy || !working || problems.length > 0} onClick={() => void go()} data-testid="post-now">
              {busy ? "Posting…" : "Post now"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
