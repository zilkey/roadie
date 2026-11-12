"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { PageTitle } from "@/components/ui";
import { useArtist, useArtistRouter } from "@/lib/artist";
import { ChecklistTemplatesEditor, isTemplateKind } from "@/components/shows/checklists/ChecklistTemplatesEditor";

export default function ChecklistTemplatesPage() { return <AdminOnly><Suspense fallback={null}><Body /></Suspense></AdminOnly>; }

/** Artist settings › Checklist templates: one tab per kind of list (?tab=show|release|social, show by default). */
function Body() {
  const tab = useSearchParams().get("tab");
  const kind = isTemplateKind(tab) ? tab : "show";
  const router = useArtistRouter();
  const artist = useArtist().doc;
  return (
    <div className="grid gap-5">
      <PageTitle title="Checklist templates" sub="Lists you copy onto a show, a release, or the Social Media sidebar. Changing a template never changes lists already copied." />
      {artist && <ChecklistTemplatesEditor artistId={artist.id} kind={kind} onKind={(k) => router.replace(`/admin/checklists?tab=${k}`, { scroll: false })} />}
    </div>
  );
}
