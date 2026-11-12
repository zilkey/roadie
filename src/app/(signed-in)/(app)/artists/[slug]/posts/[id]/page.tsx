"use client";
import { useParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { BackLink } from "@/components/BackLink";
import { ErrorBox } from "@/components/ui";
import { useDoc } from "@/lib/firestore-hooks";
import { CarouselEditor } from "@/components/posts/CarouselEditor";
import type { Post } from "@/schema/posts";

/** Posts are admins-only. */
export default function PostPage() { return <AdminOnly><PostEditor /></AdminOnly>; }

/** One post in the carousel editor: the live doc (so an Undo shows at once), with posts.get's previews inside the editor. */
function PostEditor() {
  const { id } = useParams<{ id: string }>();
  const { doc, loading, error } = useDoc<Post & { rev?: number }>("posts", id);
  return (
    <div className="grid gap-3">
      <BackLink href="/posts" label="Posts" />
      <ErrorBox error={error} />
      {loading ? <p className="s" data-testid="editor-loading">Loading…</p>
        : !doc ? <p className="m-0" data-testid="editor-gone">That post isn&apos;t there. It may have been deleted.</p>
        : <CarouselEditor post={doc} />}
    </div>
  );
}
