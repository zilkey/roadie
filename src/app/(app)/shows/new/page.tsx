"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { PageTitle, useCommand } from "@/components/ui";
import { BackLink } from "@/components/booking/common";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { ShowForm, dealOf, timesOf, type ShowFormState } from "@/components/shows/ShowForm";
import type { Artist, Availability, Edition, Musician, Pitch, Promoter, Venue } from "@/schema";

export default function Page() { return <AdminOnly><Suspense><NewShow /></Suspense></AdminOnly>; }

type PitchDoc = Row<Omit<Pitch, "createdAt" | "updatedAt" | "deletedAt" | "lastContactAt">>;

function NewShow() {
  const pitchId = useSearchParams().get("pitch") ?? "";
  const pitch = useDoc<PitchDoc>("pitches", pitchId || "none");
  const venues = useCollection<Venue>("venues");
  const promoters = useCollection<Promoter>("promoters");
  const editions = useCollection<Edition>("editions");
  const musicians = useCollection<Musician>("musicians");
  const artists = useCollection<Artist>("artists");
  const asks = useCollection<Availability>("availability");
  const loading = [venues, promoters, editions, musicians, artists, asks].some((c) => c.loading) || (!!pitchId && pitch.loading);
  if (loading) return <span className="s">Loading…</span>;
  return (
    <NewShowForm pitchId={pitchId} pitch={pitchId ? pitch.doc : null} venues={venues.rows ?? []} promoters={promoters.rows ?? []} editions={editions.rows ?? []}
      musicians={musicians.rows ?? []} artist={(artists.rows ?? [])[0]} asks={asks.rows ?? []} />
  );
}

function NewShowForm({ pitchId, pitch, venues, promoters, editions, musicians, artist, asks }: {
  pitchId: string; pitch: PitchDoc | null; venues: Row<Venue>[]; promoters: Row<Promoter>[]; editions: Row<Edition>[]; musicians: Row<Musician>[];
  artist?: Row<Artist>; asks: Row<Availability>[];
}) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const t = pitch?.target;
  const venueId = t?.kind === "venue" ? t.id : t?.kind === "promoter" ? promoters.find((p) => p.id === t.id)?.venueIds[0] ?? "" : "";
  const edition = t?.kind === "edition" ? editions.find((e) => e.id === t.id) : undefined;
  const ask = asks.filter((a) => a.pitchId === pitchId).sort((a, b) => b.date.localeCompare(a.date))[0];
  const cfg = artist?.configurations.find((c) => c.id === pitch?.pitchedAs);
  const v0 = venues.find((v) => v.id === venueId);
  const [s, setS] = useState<ShowFormState>({
    venueId, date: ask?.date ?? edition?.startDate ?? "", status: "confirmed", loadIn: "", soundcheck: "", doors: "", set: "", setLength: "",
    billedAs: pitch?.pitchedAs ?? "", personnel: pitch?.personnel?.length ? pitch.personnel : cfg?.musicianIds ?? [],
    soundProvider: v0?.sound?.provider ?? "venueProvided", soundNotes: v0?.sound?.notes ?? "",
    poster: false, backline: false, merch: false, calendar: true, public: false, ticketUrl: "", bandNotes: "",
    dealType: "guarantee", guarantee: "", doorSplitPct: "", ticketPrice: "",
  });

  async function save() {
    const r = await call<{ id: string }>("shows.create", {
      pitchId: pitchId || undefined, date: s.date, status: s.status === "hold" ? "hold" : "confirmed", venueId: s.venueId,
      editionName: edition ? `${edition.festivalName} ${edition.label}` : undefined, times: timesOf(s),
      billedAs: s.billedAs || undefined, personnel: s.personnel,
      sound: { provider: s.soundProvider, ...(s.soundNotes.trim() ? { notes: s.soundNotes.trim() } : {}) },
      needs: { poster: s.poster, backline: s.backline, merch: s.merch }, public: s.public, ticketUrl: s.public && s.ticketUrl ? s.ticketUrl : undefined,
      bandNotes: s.bandNotes.trim() || undefined, addToCalendar: s.calendar,
      deal: { ...dealOf(s), ...(edition ? { editionId: edition.id } : {}) },
    });
    if (r) router.push(`/shows/${r.id}`);
  }

  return (
    <div className="grid gap-3" data-testid="new-show">
      <BackLink href={pitchId ? `/booking/pitches/${pitchId}` : "/shows"} label={pitchId ? "Pitch" : "Shows"} />
      <PageTitle title="New show" sub={t ? `From the pitch to ${t.name}` : "Add a show that didn't come from the Pitch List."} />
      <ShowForm mode="create" value={s} onChange={setS} venues={venues} artist={artist} musicians={musicians} error={error} busy={busy} submitLabel="Save show" onSubmit={save} />
    </div>
  );
}
