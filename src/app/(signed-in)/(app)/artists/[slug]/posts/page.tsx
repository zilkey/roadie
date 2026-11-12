"use client";
import { useEffect, useState } from "react";
import Link from "@/lib/artist";
import { ErrorBox, PageTitle } from "@/components/ui";
import { AdminOnly } from "@/components/Guard";
import { runCommand } from "@/lib/commands";
import { fmtInstant } from "@/lib/timezone";
import { PostsTabs } from "@/components/posts/PostsTabs";
import type { MetaStatus } from "@/components/posts/MetaCard";

/** A post as posts.list returns it. */
interface PostRow {
  id: string; title?: string; status: "draft" | "publishing" | "posted" | "failed"; postedAt?: string; count: number; thumb?: string;
  permalink?: string | null; error?: string; driveTidy?: { error: string };
}

/** Posts is admins-only, like Booking: members are sent back to the Calendar. */
export default function PostsPage() { return <AdminOnly><Posts /></AdminOnly>; }

/**
 * Posts › Posts: the drafts (with failed posts and any being posted) first, then what's been posted to Instagram; each opens
 * in the editor. Photos are picked on the Photos tab. Whether Instagram is connected is said here, since posting needs it.
 */
function Posts() {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [list, setList] = useState<{ drafts: PostRow[]; posts: PostRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    runCommand<MetaStatus>("meta.status", {}).then(setStatus, (e: Error) => setError(e.message));
    runCommand<{ drafts: PostRow[]; posts: PostRow[] }>("posts.list", {}).then(setList, (e: Error) => setError(e.message));
  }, []);
  const connected = status?.connection;

  return (
    <div className="grid gap-5">
      <PageTitle title="Posts" />
      <PostsTabs at="posts" />
      <ErrorBox error={error} />
      {status && (!connected ? (
        <p className="m-0" data-testid="posts-not-connected">Instagram isn&apos;t connected. <Link href="/admin/mcp" className="underline">Connect it in Settings › Integrations</Link>.</p>
      ) : status.check && !status.check.working ? (
        <p className="err m-0" data-testid="posts-sign-in-again">Sign in again: {status.check.reason} <Link href="/admin/mcp" className="underline">Connect again in Settings › Integrations</Link>.</p>
      ) : <p className="s m-0" data-testid="posts-account">Posting to @{connected.instagram.username}.</p>)}
      {!list ? (!error && <p className="s" data-testid="posts-loading">Loading…</p>) : (
        <>
          <PostSection title="Drafts" testid="posts-drafts" rows={list.drafts}
            empty={<>No drafts. Pick photos on the <Link href="/posts/photos" className="underline">Photos</Link> tab.</>} />
          <PostSection title="Posted" testid="posts-list" rows={list.posts} empty="Nothing posted from Roadie yet." />
        </>
      )}
    </div>
  );
}

function PostSection({ title, testid, rows, empty }: { title: string; testid: string; rows: PostRow[]; empty: React.ReactNode }) {
  return (
    <section className="grid gap-2" aria-labelledby={`${testid}-title`} data-testid={testid}>
      <h2 id={`${testid}-title`} className="font-display text-lg font-bold">{title}</h2>
      {rows.length === 0 && <p className="s m-0" data-testid={`${testid}-none`}>{empty}</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((p) => (
          <li key={p.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3" data-testid={`post-${p.id}`}>
            {p.thumb ? <img src={p.thumb} alt="" className="h-14 w-14 shrink-0 rounded-md bg-soft object-cover" loading="lazy" />
              : <span className="h-14 w-14 shrink-0 rounded-md bg-soft" />}
            <span className="grid min-w-0 flex-1 gap-0.5">
              <Link href={`/posts/${p.id}`} className="truncate font-bold no-underline hover:underline" data-testid="post-title">{p.title ?? <i className="s">Untitled</i>}</Link>
              <span className="s" data-testid="post-meta">
                {p.count === 1 ? "1 photo" : `${p.count} photos`}
                {p.status === "draft" && " · Draft"}
                {p.postedAt && ` · Posted ${fmtInstant(p.postedAt)}`}
              </span>
              {p.status === "failed" && <span className="err m-0" data-testid="post-failed">Didn&apos;t post: {p.error ?? "Instagram didn't say why."}</span>}
              {p.status === "publishing" && <span className="s" data-testid="post-publishing">Posting…</span>}
              {p.driveTidy && <span className="err m-0" data-testid="post-tidy">Posted, but Drive wasn&apos;t tidied: {p.driveTidy.error}</span>}
            </span>
            {p.status === "posted" && p.permalink && (
              <a href={p.permalink} target="_blank" rel="noreferrer" className="s shrink-0 underline" data-testid="post-view">View on Instagram ›</a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
