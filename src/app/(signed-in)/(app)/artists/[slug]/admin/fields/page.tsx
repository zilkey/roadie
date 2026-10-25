"use client";
import { AdminOnly } from "@/components/Guard";
import { PageTitle } from "@/components/ui";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { useArtist } from "@/lib/artist";

export default function FieldsPage() { return <AdminOnly><Fields /></AdminOnly>; }

/** Custom fields: the artist's own extra facts, one card for shows and one for songs. Each change saves on its own (its own command). */
function Fields() {
  const artist = useArtist().doc;
  if (!artist) return <p className="s">Loading…</p>;
  return (
    <div className="grid gap-5">
      <PageTitle title="Custom fields" sub="Extra facts to keep on every show or song. Define them here, fill them in on the show or song." />
      <CustomFieldsEditor artist={artist} kind="show" />
      <CustomFieldsEditor artist={artist} kind="song" />
    </div>
  );
}
