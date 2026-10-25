"use client";
import { useProfile } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { BookingHome } from "@/components/booking/BookingHome";
import { HomeShows } from "@/components/shows/HomeShows";
import { UnfinishedCard } from "@/components/drafts/UnfinishedCard";

export default function Home() {
  const p = useProfile();
  return (
    <div className="grid gap-5">
      <PageTitle title={`Hi, ${p.name}`} sub={p.role === "admin" ? "Here's what needs you." : "Your upcoming shows."} />
      <UnfinishedCard />
      <HomeShows regular={<BookingHome />} />
    </div>
  );
}
