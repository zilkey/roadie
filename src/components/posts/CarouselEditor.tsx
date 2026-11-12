"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { SaveStatus } from "@/components/SaveStatus";
import { toast } from "@/components/Toasts";
import { useAutosave } from "@/lib/autosave";
import { useDragReorder } from "@/lib/drag-reorder";
import { runCommand } from "@/lib/commands";
import { CAPTION_MAX, HASHTAG_MAX, hashtagCount } from "@/lib/photos";
import type { Post, PostMedia } from "@/schema/posts";
import { PostDialog } from "@/components/posts/PostDialog";

type Focus = { x: number; y: number };
interface PhotoState { thumb1080: string; missing: boolean; trashed: boolean }
const CENTER: Focus = { x: 0.5, y: 0.5 };
const label = (m: Pick<PostMedia, "name">) => (m.name ?? "This photo").replace(/\.[^.]+$/, "");
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The carousel editor (the canvas's *Edit the carousel* board). `post` is the live doc; posts.get adds each photo's 1080
 * preview and whether it's still in Drive. Caption, aspect, order, alt text and crop autosave through posts.updateDraft
 * (Firestore only, so each has its Undo toast); the pencil renames the draft and its folder (posts.rename); × and Remove take
 * a photo out (posts.removeFromDraft); Delete draft puts every photo back (posts.deleteDraft). Those three change Drive and
 * have no Undo. A posted post, or one being posted, is read-only.
 */
export function CarouselEditor({ post }: { post: Post & { id: string; rev?: number } }) {
  const router = useRouter();
  const id = post.id;
  const readOnly = post.status === "posted" || post.status === "publishing";
  const drive = useCommand();
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const [local, setLocal] = useState<PostMedia[] | null>(null);
  const [aspect, setAspect] = useState<"4:5" | "1:1" | null>(null);
  const [at, setAt] = useState(0);
  const [naming, setNaming] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const as = useAutosave({
    command: "posts.updateDraft", id, rev: post.rev, title: post.title ?? "Post",
    onRestore: (p) => {
      if (p.aspect === "4:5" || p.aspect === "1:1") setAspect(p.aspect);
    },
    onUseTheirs: () => { setLocal(null); setAspect(null); },
  });

  // What the live doc says, unless an edit of ours hasn't come back yet.
  const { isBusy, status } = as;
  useEffect(() => { if (!isBusy()) { setLocal(null); setAspect(null); } }, [post.rev, status, isBusy]);
  const media = local ?? post.media;
  const shape = aspect ?? post.aspect ?? "4:5";
  const ids = post.media.map((m) => m.driveFileId).join(",");

  const load = useCallback(() => {
    runCommand<{ photos: Record<string, PhotoState> }>("posts.get", { id }).then((r) => setPhotos(r.photos), () => undefined);
  }, [id]);
  useEffect(load, [load, ids]);
  useEffect(() => { if (at >= media.length) setAt(Math.max(0, media.length - 1)); }, [at, media.length]);

  /** The whole items map: autosave merges per top-level key, so a partial map would drop another photo's edit. */
  const items = (list: PostMedia[]) => Object.fromEntries(list.map((m) => [m.driveFileId, { ...(m.alt !== undefined ? { alt: m.alt } : { alt: "" }), ...(m.focus ? { focus: m.focus } : {}) }]));
  const edit = (list: PostMedia[], patch: Record<string, unknown>, now = false) => { setLocal(list); as.patch(patch, { now }); };
  const setItem = (i: number, change: Partial<PostMedia>, now = false) => {
    const next = media.map((m, j) => (j === i ? { ...m, ...change } : m));
    edit(next, { items: items(next) }, now);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= media.length || from === to) return;
    const next = [...media];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    edit(next, { order: next.map((x) => x.driveFileId) }, true);
    setAt(to);
  };
  const drag = useDragReorder(move);

  /** Drive changes wait for any pending autosave, so the edit and the move don't cross. */
  async function remove(m: PostMedia) {
    await as.flush();
    if (await drive.call("posts.removeFromDraft", { id, driveFileId: m.driveFileId })) setLocal(null);
  }
  async function rename(title: string) {
    setNaming(null);
    const t = title.trim();
    if (!t || t === post.title) return;
    await as.flush();
    await drive.call("posts.rename", { id, title: t });
  }
  async function tidy() {
    if (await drive.call("posts.tidy", { id })) toast({ key: `posts.tidy:${id}`, text: "Drive is tidied" });
  }
  async function deleteDraft() {
    if (!window.confirm(`Delete the draft ${post.title ?? ""}? Its photos go back where they came from in Socials.`)) return;
    await as.flush();
    const r = await drive.call<{ folderLeft: boolean; notMoved: string[]; message?: string }>("posts.deleteDraft", { id });
    if (!r) return;
    if (r.notMoved.length) { drive.setError(r.message ?? `Couldn't move ${r.notMoved.join(", ")} back`); return; }
    toast({ key: `posts.deleteDraft:${id}`, text: r.message ?? `Deleted ${post.title ?? "the draft"}; its photos are back in Socials` });
    router.push("/posts");
  }

  const caption = as.bind("caption", post.caption ?? "");
  const cur = media[at];
  const tags = hashtagCount(caption.value);

  return (
    <div className="grid gap-5 pb-10" data-testid="carousel-editor">
      <div className="flex flex-wrap items-center gap-3">
        {naming !== null ? (
          <input className="input max-w-md text-lg font-bold" autoFocus maxLength={100} value={naming} aria-label="Post name"
            onChange={(e) => setNaming(e.target.value)} onBlur={() => void rename(naming)}
            onKeyDown={(e) => { if (e.key === "Enter") void rename(naming); if (e.key === "Escape") setNaming(null); }} data-testid="editor-title-input" />
        ) : (
          <h1 className="m-0 font-display text-2xl font-bold" data-testid="editor-title">{post.title ?? "Untitled"}</h1>
        )}
        {!readOnly && naming === null && (
          <button type="button" className="icon-btn" aria-label="Rename" onClick={() => setNaming(post.title ?? "")} data-testid="editor-rename">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
          </button>
        )}
        <span className="s" data-testid="editor-status">
          {post.status === "draft" ? "Draft" : post.status === "failed" ? "Didn't post" : post.status === "publishing" ? "Posting…" : "Posted"}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {!readOnly && <SaveStatus {...as.statusProps} />}
          <Link href="/posts" className="btn sm" onClick={() => void as.flush()} data-testid="editor-done">Done</Link>
        </span>
      </div>
      {post.status === "failed" && post.error && <p className="err m-0" data-testid="editor-failed">Didn&apos;t post: {post.error}</p>}
      {post.status === "posted" && post.instagram?.permalink && (
        <p className="m-0"><a href={post.instagram.permalink} target="_blank" rel="noreferrer" className="underline" data-testid="editor-permalink">View on Instagram ›</a></p>
      )}
      {post.status === "posted" && post.driveTidy && (
        <p className="err m-0" data-testid="editor-tidy">
          Posted, but Drive wasn&apos;t tidied: {post.driveTidy.error}{" "}
          <button type="button" className="btn ghost sm" disabled={drive.busy} onClick={() => void tidy()} data-testid="editor-tidy-button">Finish tidying Drive</button>
        </p>
      )}
      <ErrorBox error={drive.error} />

      <div className="grid gap-5 md:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="grid content-start gap-3">
          {cur && <CropFrame key={cur.driveFileId} src={photos[cur.driveFileId]?.thumb1080} shape={shape} focus={cur.focus ?? CENTER} readOnly={readOnly}
            onMove={(f) => setLocal(media.map((m, j) => (j === at ? { ...m, focus: f } : m)))} onDone={(f) => setItem(at, { focus: f }, true)} />}
          <div className="flex items-center gap-2" role="group" aria-label="Shape">
            {(["4:5", "1:1"] as const).map((a) => (
              <button key={a} type="button" className={`btn sm ${shape === a ? "" : "ghost"}`} aria-pressed={shape === a} disabled={readOnly}
                onClick={() => { setAspect(a); as.patch({ aspect: a }, { now: true }); }} data-testid={`editor-aspect-${a === "4:5" ? "45" : "11"}`}>
                {a === "4:5" ? "4:5" : "Square"}
              </button>
            ))}
            {!readOnly && <span className="s">Drag the photo to move the crop.</span>}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <ol className="m-0 grid list-none gap-2 p-0" aria-label="Photos in order" data-testid="editor-photos">
            {media.map((m, i) => {
              const st = photos[m.driveFileId];
              const gone = st?.missing || st?.trashed;
              return (
                <li key={m.driveFileId} {...(readOnly ? {} : drag.row(i))}
                  className={`grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-lg border p-2 ${i === at ? "border-[var(--accent)]" : "border-line"} bg-surface`}
                  data-testid={`editor-photo-${m.driveFileId}`}>
                  {!readOnly ? (
                    <span {...drag.handle(i)} className="cursor-grab select-none px-1 text-lg leading-none text-[var(--muted)]" aria-hidden title="Drag to reorder">⋮⋮</span>
                  ) : <span />}
                  <button type="button" className="relative h-14 w-14 overflow-hidden rounded-md bg-soft p-0" onClick={() => setAt(i)} aria-label={`Show ${label(m)}`} data-testid={`editor-pick-${m.driveFileId}`}>
                    {st?.thumb1080 && !gone && <img src={st.thumb1080} alt="" className="h-full w-full object-cover" />}
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-xs font-bold text-white">{i + 1}</span>
                  </button>
                  <div className="grid min-w-0 gap-1">
                    <span className="truncate text-sm" title={m.name}>{label(m)}</span>
                    {gone ? (
                      <span className="err m-0 text-sm" data-testid={`editor-missing-${m.driveFileId}`}>
                        {label(m)} is no longer in Drive{" "}
                        {!readOnly && <button type="button" className="btn ghost sm" disabled={drive.busy} onClick={() => void remove(m)} data-testid={`editor-missing-remove-${m.driveFileId}`}>Remove</button>}
                      </span>
                    ) : readOnly ? (m.alt && <span className="s">{m.alt}</span>) : (
                      <input className="input" placeholder="Alt text: what's in the photo" maxLength={1000} value={m.alt ?? ""} aria-label={`Alt text for ${label(m)}`}
                        onChange={(e) => setItem(i, { alt: e.target.value })} onBlur={() => void as.flush()} data-testid={`editor-alt-${m.driveFileId}`} />
                    )}
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-1">
                      <button type="button" className="icon-btn" aria-label={`Move ${label(m)} up`} disabled={i === 0} onClick={() => move(i, i - 1)} data-testid={`editor-up-${m.driveFileId}`}>↑</button>
                      <button type="button" className="icon-btn" aria-label={`Move ${label(m)} down`} disabled={i === media.length - 1} onClick={() => move(i, i + 1)} data-testid={`editor-down-${m.driveFileId}`}>↓</button>
                      <button type="button" className="icon-btn" aria-label={`Take ${label(m)} out`} disabled={drive.busy || media.length === 1}
                        title={media.length === 1 ? "Delete the draft instead" : "Take it out: it goes back to its folder in Socials"}
                        onClick={() => void remove(m)} data-testid={`editor-remove-${m.driveFileId}`}>×</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {!readOnly && media.length < 10 && (
            <Link href={`/posts/photos?draft=${id}`} className="btn ghost sm justify-self-start" onClick={() => void as.flush()} data-testid="editor-add-photos">Add photos</Link>
          )}

          <label className="grid gap-1">
            <span className="font-bold">Caption</span>
            {readOnly ? <p className="m-0 whitespace-pre-wrap" data-testid="editor-caption-text">{post.caption}</p> : (
              <textarea className="input" rows={6} maxLength={CAPTION_MAX} {...caption} data-testid="editor-caption" />
            )}
          </label>
          {!readOnly && (
            <p className={`s m-0 ${tags > HASHTAG_MAX ? "err" : ""}`} data-testid="editor-counts">
              {caption.value.length.toLocaleString()} / {CAPTION_MAX.toLocaleString()} characters · {tags} / {HASHTAG_MAX} hashtags
            </p>
          )}
          {!readOnly && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <button type="button" className="btn ghost sm" disabled={drive.busy} onClick={() => void deleteDraft()} data-testid="editor-delete">Delete draft</button>
              <button type="button" className="btn sm ml-auto" disabled={drive.busy || media.some((m) => photos[m.driveFileId]?.missing || photos[m.driveFileId]?.trashed)}
                title="Post it to Instagram" onClick={() => setPosting(true)} data-testid="editor-post">Post…</button>
            </div>
          )}
          <PostDialog open={posting} onClose={() => setPosting(false)} post={{ id, title: post.title, media }} before={() => as.flush()} />
        </div>
      </div>
    </div>
  );
}

/**
 * The preview in the post's shape with the crop the post will get: `object-fit: cover` at `object-position: fx·100% fy·100%`,
 * the same rule the media route crops with. Dragging the photo moves it: fx changes by −dx / (renderedWidth − frameWidth).
 */
function CropFrame({ src, shape, focus, readOnly, onMove, onDone }: {
  src?: string; shape: "4:5" | "1:1"; focus: Focus; readOnly: boolean; onMove(f: Focus): void; onDone(f: Focus): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number; f: Focus; last: Focus } | null>(null);
  const at = (e: React.PointerEvent): Focus => {
    const s = start.current!, fr = frame.current!.getBoundingClientRect(), im = img.current!;
    const W = im.naturalWidth || fr.width, H = im.naturalHeight || fr.height;
    const k = Math.max(fr.width / W, fr.height / H), rw = W * k, rh = H * k;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    return {
      x: rw - fr.width > 0.5 ? clamp(s.f.x - dx / (rw - fr.width)) : s.f.x,
      y: rh - fr.height > 0.5 ? clamp(s.f.y - dy / (rh - fr.height)) : s.f.y,
    };
  };
  return (
    <div ref={frame} className={`relative w-full overflow-hidden rounded-lg bg-soft ${readOnly ? "" : "cursor-move touch-none"}`}
      style={{ aspectRatio: shape === "4:5" ? "4 / 5" : "1 / 1" }} data-testid="editor-crop" data-focus={`${focus.x.toFixed(3)},${focus.y.toFixed(3)}`}
      onPointerDown={readOnly ? undefined : (e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY, f: focus, last: focus }; }}
      onPointerMove={readOnly ? undefined : (e) => { if (!start.current) return; const f = at(e); start.current.last = f; onMove(f); }}
      onPointerUp={readOnly ? undefined : () => { const s = start.current; start.current = null; if (s && (s.last.x !== s.f.x || s.last.y !== s.f.y)) onDone(s.last); }}>
      {src && <img ref={img} src={src} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
        style={{ objectPosition: `${focus.x * 100}% ${focus.y * 100}%` }} />}
    </div>
  );
}
