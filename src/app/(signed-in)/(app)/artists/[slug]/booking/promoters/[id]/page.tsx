"use client";
import { useParams } from "next/navigation";
import { PromoterWorkspace } from "@/components/booking/PromoterWorkspace";

/** A promoter's one tabbed page (#82): its own route opens Promoter details (the pitch's route opens Pitch). */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PromoterWorkspace placeId={id} defaultTab="details" />;
}
