"use client";
import Link from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { ADMIN_LINKS } from "@/components/Shell";
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
      {p.role === "admin" && (
        <div className="card" data-testid="band-setup">
          <span className="lbl">Band setup</span>
          <div className="flex flex-wrap gap-2">
            {ADMIN_LINKS.map((l) => <Link key={l.href} href={l.href} data-testid={l.testid} className="btn ghost sm">{l.label}</Link>)}
          </div>
        </div>
      )}
    </div>
  );
}
