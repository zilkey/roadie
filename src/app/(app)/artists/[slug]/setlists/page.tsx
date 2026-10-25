"use client";
import { PageTitle } from "@/components/ui";
import { SetlistsList } from "@/components/music/SetlistsList";

export default function SetlistsPage() {
  return (
    <div className="grid gap-5" data-testid="setlists-page">
      <PageTitle title="Setlist Templates" />
      <SetlistsList />
    </div>
  );
}
