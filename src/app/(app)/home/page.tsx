"use client";
import Link from "next/link";
import { useProfile } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { ADMIN_LINKS } from "@/components/Shell";
import { BookingHome } from "@/components/booking/BookingHome";

export default function Home() {
  const p = useProfile();
  return (
    <div className="grid gap-3">
      <PageTitle title={`Hi, ${p.name}`} sub={p.role === "admin" ? "Here's what needs you." : "Your upcoming shows."} />
      {/* Slice 4 puts today's show / unsettled show / next show cards above this, per "How Home decides". */}
      {p.role === "admin" ? <BookingHome /> : <div className="card" data-testid="home-stub"><span className="s">Upcoming shows arrive in slice 4.</span></div>}
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
