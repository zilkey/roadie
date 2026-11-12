"use client";
import { useParams } from "next/navigation";
import { VenueWorkspace } from "@/components/booking/VenueWorkspace";

/** A venue's one tabbed page (#82): its own route opens Venue details (the pitch's route opens the Pitch tab). */
export default function VenuePage() {
  const { id } = useParams<{ id: string }>();
  return <VenueWorkspace venueId={id} defaultTab="details" />;
}
