"use client";
import { useParams } from "next/navigation";
import Link, { useMaybeArtist } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { PageTitle } from "@/components/ui";
import { useDoc } from "@/lib/firestore-hooks";
import { MemberDates } from "@/components/shows/PitchAvailability";
import { PitchBody } from "@/components/booking/PitchBody";
import { VenueWorkspace } from "@/components/booking/VenueWorkspace";
import { PromoterWorkspace } from "@/components/booking/PromoterWorkspace";
import { EditionWorkspace } from "@/components/booking/EditionWorkspace";
import type { PitchRow } from "@/components/booking/common";

/** Booking is admins' business. Members land here from a Who's free post in Signal: they get just the asks they're on, to answer. */
export default function Page() {
  const artist = useMaybeArtist();
  if (!artist) return null;
  return artist.role === "admin" ? <AdminOnly><PitchRoute /></AdminOnly> : <MemberAsks />;
}

/**
 * A venue's pitch opens the venue's one tabbed page on its Pitch tab (#82, Jeff 2026-11-12: Pitch | Venue details | Venue events);
 * the route only decides the tab. Promoters (Pitch | Promoter details) and festival years (Pitch | Festival details) the same.
 */
function PitchRoute() {
  const { id } = useParams<{ id: string }>();
  const { doc: p, loading } = useDoc<PitchRow>("pitches", id);
  if (loading) return null;
  if (p?.target.kind === "venue") return <VenueWorkspace venueId={p.target.id} pitchId={id} defaultTab="pitch" />;
  if (p?.target.kind === "promoter") return <PromoterWorkspace placeId={p.target.id} pitchId={id} defaultTab="pitch" />;
  if (p?.target.kind === "edition") return <EditionWorkspace placeId={p.target.id} pitchId={id} defaultTab="pitch" />;
  return <PitchBody id={id} />;
}

function MemberAsks() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto grid w-full max-w-md gap-5" data-testid="member-asks">
      <PageTitle title="Can you play?" />
      <MemberDates pitchId={id}
        empty={<div className="card"><p className="s" data-testid="member-asks-none">Nothing to answer here. <Link href="/calendar">Back to the calendar</Link></p></div>} />
    </div>
  );
}
