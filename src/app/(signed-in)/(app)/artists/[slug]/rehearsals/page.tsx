"use client";
import Link from "@/lib/artist";
import { PageTitle } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { RehearsalsList } from "@/components/music/RehearsalsList";

export default function RehearsalsPage() {
  const admin = useProfile().role === "admin";
  return (
    <div className="grid gap-5" data-testid="rehearsals-page">
      <PageTitle title="Rehearsals" center
        actions={admin ? <Link href="/rehearsals/new" className="btn acc" data-testid="log-rehearsal">Log a rehearsal</Link> : undefined} />
      <RehearsalsList />
    </div>
  );
}
