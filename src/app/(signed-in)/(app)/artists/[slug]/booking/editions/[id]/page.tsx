"use client";
import { useParams } from "next/navigation";
import { EditionWorkspace } from "@/components/booking/EditionWorkspace";

/** A edition's one tabbed page (#82): its own route opens Festival details (the pitch's route opens Pitch). */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <EditionWorkspace placeId={id} defaultTab="details" />;
}
