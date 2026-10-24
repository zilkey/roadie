"use client";
import { draftPath } from "@/schema/drafts";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { PageTitle, PickChip, useCommand } from "@/components/ui";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { fmtPitchDate, sortedDates, todayStr } from "@/lib/booking";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { ShowForm, dealOf, timesOf, whereInput, type ShowFormState } from "@/components/shows/ShowForm";
import type { Artist, Availability, Contact, Edition, Musician, Pitch, Promoter, Venue } from "@/schema";

export default function Page() { return <AdminOnly><Suspense><NewShow /></Suspense></AdminOnly>; }

type PitchDoc = Row<Omit<Pitch, "createdAt" | "updatedAt" | "deletedAt" | "lastContactAt">>;

function NewShow() {
  const pitchId = useSearchParams().get("pitch") ?? "";
  const pitch = useDoc<PitchDoc>("pitches", pitchId || "none");
  const venues = useCollection<Venue>("venues");
  const promoters = useCollection<Promoter>("promoters");
  const editions = useCollection<Edition>("editions");
  const contacts = useCollection<Contact>("contacts");
  const musicians = useCollection<Musician>("musicians");
  const { doc: artist } = useArtist();
  const asks = useCollection<Availability>("availability");
  const loading = ([venues, promoters, editions, contacts, musicians, asks].some((c) => c.loading) || !artist) || (!!pitchId && pitch.loading);
  if (loading) return <span className="s">Loading…</span>;
  return (
    <NewShowForm pitchId={pitchId} pitch={pitchId ? pitch.doc : null} venues={venues.rows ?? []} promoters={promoters.rows ?? []} editions={editions.rows ?? []} contacts={contacts.rows ?? []}
      musicians={musicians.rows ?? []} artist={artist ?? undefined} asks={asks.rows ?? []} />
  );
}

function NewShowForm({ pitchId, pitch, venues, promoters, editions, contacts, musicians, artist, asks }: {
  pitchId: string; pitch: PitchDoc | null; venues: Row<Venue>[]; promoters: Row<Promoter>[]; editions: Row<Edition>[]; contacts: Row<Contact>[]; musicians: Row<Musician>[];
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
  const blank: ShowFormState = {
    where: "venue", venueId, hostContactIds: [], city: "", address: "", editionId: edition?.id ?? "", date: ask?.date ?? edition?.startDate ?? "", status: "confirmed", loadIn: "", soundcheck: "", doors: "", set: "", setLength: "",
    billedAs: pitch?.pitchedAs ?? "", personnel: pitch?.personnel?.length ? pitch.personnel : cfg?.musicianIds ?? [],
    soundProvider: v0?.sound?.provider ?? "venueProvided", soundNotes: v0?.sound?.notes ?? "",
    poster: false, backline: false, merch: false, calendar: true, public: false, ticketUrl: "", bandNotes: "",
    dealType: "guarantee", guarantee: "", doorSplitPct: "", ticketPrice: "",
  };
  // New record = draft: saved as you type (device, then server), restored on any machine, deleted when the show is created.
  const draft = useDraft(pitchId ? draftPath.newUnder("pitches", pitchId, "shows") : draftPath.newIn("shows"), blank, {
    title: (v) => `New show${v.where === "house" ? " · House concert" : venues.find((x) => x.id === v.venueId) ? ` · ${venues.find((x) => x.id === v.venueId)!.name}` : ""}${v.date ? ` · ${v.date}` : ""}`,
  });
  const s = draft.value;
  const mutationId = useRef(newMutationId());
  // A pitch with several dates: pick which become shows (one show each, sharing everything else). Default: the first upcoming one.
  const pitchDates = sortedDates(pitch?.dates);
  const [picked, setPicked] = useState<string[] | null>(null);
  const firstUpcoming = pitchDates.find((d) => d >= todayStr()) ?? pitchDates[0];
  const chosen = pitchDates.length ? (picked ?? (firstUpcoming ? [firstUpcoming] : [])).slice().sort() : [];
  const extraIds = useRef<Record<string, string>>({});

  async function save() {
    await draft.settle();
    const dates = pitchDates.length ? chosen : [s.date];
    let r: { id: string } | undefined;
    for (const [n, date] of dates.entries()) {
      const last = n === dates.length - 1;
      extraIds.current[date] ??= n === 0 ? mutationId.current : newMutationId();
      const made = await call<{ id: string }>("shows.create", {
      pitchId: pitchId || undefined, date, status: s.status === "hold" ? "hold" : "confirmed", ...whereInput(s),
      editionId: s.editionId || undefined, times: timesOf(s),
      billedAs: s.billedAs || undefined, personnel: s.personnel,
      sound: { provider: s.soundProvider, ...(s.soundNotes.trim() ? { notes: s.soundNotes.trim() } : {}) },
      needs: { poster: s.poster, backline: s.backline, merch: s.merch }, public: s.public, ticketUrl: s.public && s.ticketUrl ? s.ticketUrl : undefined,
      bandNotes: s.bandNotes.trim() || undefined, addToCalendar: s.calendar,
      deal: dealOf(s),
    }, { clientMutationId: extraIds.current[date], ...(last ? { clearDraft: draft.draftId } : {}) });
      if (!made) return;
      r ??= made;
    }
    if (r) { await draft.clear(); router.push(dates.length > 1 ? `/booking/pitches/${pitchId}` : `/shows/${r.id}`); }
  }

  return (
    <div className="grid gap-5" data-testid="new-show">
      <PageTitle back={<Link href={pitchId ? `/booking/pitches/${pitchId}` : "/shows"} className="back-link" data-testid="back">{pitchId ? "← Pitch" : "← All shows"}</Link>} title="New show" sub={t ? `From the pitch to ${t.name}` : "Add a show that didn't come from the Pitch List."} />
      {!draft.ready ? <span className="s">Loading…</span> : <>
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <ShowForm mode="create" value={{ ...blank, ...s }} onChange={draft.setValue} venues={venues} contacts={contacts} editions={editions} artist={artist} musicians={musicians} error={error} busy={busy || (pitchDates.length > 0 && chosen.length === 0)} submitLabel={chosen.length > 1 ? `Add ${chosen.length} shows` : "Add show"} onSubmit={save}
          dateSlot={pitchDates.length ? (
            <div className="grid gap-1.5" data-testid="pitch-date-picker">
              <span className="lbl">Which dates are shows?</span>
              <div className="flex flex-wrap gap-1.5">
                {pitchDates.map((d) => {
                  const on = chosen.includes(d);
                  return <PickChip key={d} on={on} testid={`pick-date-${d}`}
                    onToggle={() => setPicked(on ? chosen.filter((x) => x !== d) : [...chosen, d])}>{fmtPitchDate(d)}</PickChip>;
                })}
              </div>
              <span className="s">One show per date, all with the details below.</span>
            </div>
          ) : undefined} />
      </>}
    </div>
  );
}
