"use client";
import { useEffect, useMemo, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { AdminOnly } from "@/components/Guard";
import { useCollection } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import { fmtInstant } from "@/lib/timezone";
import { DrivePicker, type Hit } from "@/components/music/DrivePicker";
import { FileIcon, thumbOf } from "@/components/music/common";
import { Upload } from "@/components/music/Upload";
import type { MetaStatus } from "@/components/posts/MetaCard";
import type { Post } from "@/schema";

const MAX_CAPTION = 2200;
const JPEG = "image/jpeg";
const JPEG_ONLY = "Instagram takes JPEG photos";

/** The photo to post: a JPEG in the band's Drive, picked there or just uploaded to it. */
interface Photo { driveFileId: string; name: string; mimeType: string; url: string }

/** Posts is admins-only, like Booking: members are sent back to the Calendar. */
export default function PostsPage() { return <AdminOnly><Posts /></AdminOnly>; }

/**
 * Posts: for now, post one photo to the band's Instagram, then the list of posts made from Roadie. The photo comes from the
 * band's Drive (picked, or uploaded into the Posts folder first), and Post now is the only thing that posts.
 */
function Posts() {
  const { artistId } = useArtist();
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => { runCommand<MetaStatus>("meta.status", {}).then(setStatus, (e: Error) => setLoadError(e.message)); }, []);
  const connected = status?.connection;

  return (
    <div className="grid gap-5">
      <PageTitle title="Posts" />
      <ErrorBox error={loadError} />
      {!status ? (!loadError && <p className="s" data-testid="posts-loading">Loading…</p>)
        : !connected ? (
          <p className="m-0" data-testid="posts-not-connected">Instagram isn&apos;t connected. <Link href="/admin/mcp" className="underline">Connect it in Settings › Integrations</Link>.</p>
        ) : <NewPhotoPost username={connected.instagram.username} />}
      <PostList artistId={artistId} />
    </div>
  );
}

function NewPhotoPost({ username }: { username: string }) {
  const artist = useArtist().doc;
  const hasFolder = !!artist?.postsFolderId;
  const { call, error, busy, setError } = useCommand();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [way, setWay] = useState<"drive" | null>(null);
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState<{ text: string; link?: string } | null>(null);

  function pick(hits: Hit[]) {
    const h = hits[0];
    if (!h) return;
    if (h.mimeType !== JPEG) { setError(`${h.name}: ${JPEG_ONLY}.`); return; }
    setError(null);
    setPhoto({ driveFileId: h.driveFileId, name: h.name, mimeType: h.mimeType, url: h.url });
    setWay(null);
  }

  async function post() {
    if (!photo) return;
    setNote(null);
    const r = await call<{ id: string; status: "posted" | "failed"; permalink?: string | null; error?: string }>("posts.publishPhoto", { driveFileId: photo.driveFileId, caption });
    if (!r) return;
    if (r.status === "failed") { setError(r.error ?? "Instagram didn't take the post."); return; }
    setNote({ text: `Posted to @${username}.`, link: r.permalink ?? undefined });
    setPhoto(null); setCaption("");
  }

  const thumb = photo && thumbOf(photo);
  return (
    <section className="card" data-testid="new-post" aria-labelledby="new-post-title">
      <div className="card-head"><h2 id="new-post-title">Post a photo to @{username}</h2></div>
      {photo ? (
        <div className="flex items-center gap-3" data-testid="post-photo">
          {thumb ? <img src={thumb} alt="" className="h-20 w-20 shrink-0 rounded-lg bg-soft object-cover" data-testid="post-photo-thumb" />
            : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-soft"><FileIcon mime={photo.mimeType} /></span>}
          <span className="grid min-w-0 flex-1"><b className="truncate" data-testid="post-photo-name">{photo.name}</b><span className="s">From the band&apos;s Drive</span></span>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setPhoto(null); setError(null); }} data-testid="post-photo-change">Change</button>
        </div>
      ) : (
        <div className="grid gap-3" data-testid="post-photo-ways">
          <div className="flex flex-wrap items-start gap-2">
            <button type="button" className="btn" aria-expanded={way === "drive"} onClick={() => setWay(way === "drive" ? null : "drive")} data-testid="post-from-drive">Choose from Drive</button>
            <Upload<Photo> url="/api/posts/upload" label="Upload" accept="image/jpeg" testid="post-upload" disabled={!hasFolder}
              tooBig="Put it in Drive yourself, then choose it from Drive."
              needsFolder={<Link href="/admin/google" className="underline">Choose a Posts folder in Settings › Google</Link>}
              check={(f) => (f.type === JPEG ? null : JPEG_ONLY)}
              onUploaded={(p) => { setPhoto({ driveFileId: p.driveFileId, name: p.name, mimeType: p.mimeType, url: p.url }); setWay(null); setError(null); }} />
          </div>
          {way === "drive" && <DrivePicker all single placeholder="Search Drive for a photo…" testid="post-picker" onChange={() => undefined} onPickHits={pick} />}
        </div>
      )}
      <div className="grid gap-1">
        <label htmlFor="post-caption" className="lbl">Caption</label>
        <textarea id="post-caption" className="input min-h-28" maxLength={MAX_CAPTION} value={caption} onChange={(e) => setCaption(e.target.value)} data-testid="post-caption" />
        <span className="s justify-self-end" data-testid="post-caption-count">{caption.length.toLocaleString()} / {MAX_CAPTION.toLocaleString()}</span>
      </div>
      {note && (
        <p className="s m-0" role="status" data-testid="post-note">
          {note.text} {note.link && <a href={note.link} target="_blank" rel="noreferrer" className="underline" data-testid="post-note-link">View on Instagram ›</a>}
        </p>
      )}
      <ErrorBox error={error} />
      <div className="card-foot"><div className="end">
        <button type="button" className="btn acc" disabled={busy || !photo} onClick={() => void post()} data-testid="post-now">{busy ? "Posting…" : "Post now"}</button>
      </div></div>
    </section>
  );
}

/** Posts made from Roadie, newest first. A failed one stays here with Instagram's reason. */
function PostList({ artistId }: { artistId: string }) {
  const { rows } = useCollection<Post>("posts", { where: [["artistId", "==", artistId]] });
  const users = useCollection<{ name?: string; email?: string }>("users");
  const nameOf = (uid: string) => { const u = users.rows?.find((x) => x.id === uid); return u?.name ?? u?.email ?? "Someone"; };
  const at = (p: Post) => (p.createdAt as unknown as { toDate?(): Date })?.toDate?.() ?? null;
  const posts = useMemo(() => (rows ?? []).slice().sort((a, b) => (at(b)?.getTime() ?? 0) - (at(a)?.getTime() ?? 0)), [rows]);
  if (!rows) return null;
  return (
    <section className="grid gap-2" aria-labelledby="posts-list-title" data-testid="posts-list">
      <h2 id="posts-list-title" className="font-display text-lg font-bold">Posted from Roadie</h2>
      {posts.length === 0 && <p className="s m-0" data-testid="posts-none">Nothing posted from Roadie yet.</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {posts.map((p) => {
          const m = p.media[0], thumb = m && thumbOf(m), when = at(p);
          return (
            <li key={p.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3" data-testid={`post-${p.id}`}>
              {thumb ? <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-md bg-soft object-cover" loading="lazy" />
                : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-soft"><FileIcon mime={m?.mimeType} /></span>}
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate" data-testid="post-caption-start">{p.caption.trim() || <i className="s">No caption</i>}</span>
                <span className="s" data-testid="post-by">{nameOf(p.createdBy)}{when ? ` · ${fmtInstant(when)}` : ""}</span>
                {p.status === "failed" && <span className="err m-0" data-testid="post-failed">Didn&apos;t post: {p.error ?? "Instagram didn't say why."}</span>}
                {p.status === "publishing" && <span className="s" data-testid="post-publishing">Posting…</span>}
              </span>
              {p.status === "posted" && p.instagram?.permalink && (
                <a href={p.instagram.permalink} target="_blank" rel="noreferrer" className="s shrink-0 underline" data-testid="post-view">View on Instagram ›</a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
