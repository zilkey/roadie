"use client";
import { AdminOnly } from "@/components/Guard";
import { PageTitle } from "@/components/ui";
import { VenueTypesEditor } from "@/components/booking/VenueTypesEditor";

export default function VenueTypesPage() { return <AdminOnly><VenueTypesPageBody /></AdminOnly>; }

function VenueTypesPageBody() {
  return (
    <div className="grid gap-5">
      <PageTitle title="Venue types" sub="The kinds of venue (Bar, Brewery, …) to pick from on a venue. Every band that uses Roadie shares this list." />
      <VenueTypesEditor />
    </div>
  );
}
