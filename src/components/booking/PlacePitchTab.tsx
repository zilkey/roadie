"use client";
import { useState } from "react";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useSearchParams, usePathname } from "next/navigation";
import { Menu, type MenuItem } from "@/components/Menu";
import { useCommand } from "@/components/ui";
import { campaignCrumb } from "@/components/booking/BookingNav";
import { Flagged, StatusChip, StatusPill, Tabs, useBooking, type PitchRow } from "@/components/booking/common";
import { PitchBody } from "@/components/booking/PitchBody";
import { isActive } from "@/lib/booking";

/**
 * The Pitch tab shared by a place's one page (#82, Jeff 2026-11-12): a promoter (Pitch | Promoter details) and a festival year
 * (Pitch | Festival details); venues have their own (VenueWorkspace, with Venue events too). The route names the pitch, else the
 * band's active pitch on the place shows, else "Start a pitch". It also gives the page's one header its trail crumb, status pill,
 * Booked it button and the pitch's More items.
 */
export function usePlacePitch(kind: "promoter" | "edition", id: string, pitchId: string | undefined, defaultTab: "pitch" | "details") {
  const { artistId } = useArtist();
  const b = useBooking();
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { call } = useCommand();
  const [booking, setBooking] = useState(false);
  const mine = b.pitches.filter((p) => p.artistId === artistId && p.target.kind === kind && p.target.id === id);
  const pitch = mine.find((p) => p.id === pitchId) ?? mine.find((p) => isActive(p.status));
  const past = mine.filter((p) => p.id !== pitch?.id).sort((a, c) => (c.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  const campaign = pitch?.campaignId ? b.campaigns.find((c) => c.id === pitch.campaignId) : undefined;
  const asked = sp.get("tab");
  const tab: "pitch" | "details" = asked === "pitch" || asked === "details" ? asked : defaultTab;
  const setTab = (t: "pitch" | "details") => router.replace(`${pathname}${t === defaultTab ? "" : `?tab=${t}`}`);
  const crumb = pitch ? campaignCrumb(campaign, isActive(pitch.status)) : undefined;
  const pill = pitch ? <StatusPill status={pitch.status} /> : undefined;
  const bookedIt = pitch && tab === "pitch" && pitch.status !== "declined" && pitch.status !== "dropped"
    ? <button type="button" className="btn acc" onClick={() => setBooking(true)} data-testid="booked-it">Booked it</button> : null;
  const moreItems: MenuItem[] = pitch && isActive(pitch.status) ? [{ key: "remove", testid: "pitch-menu-remove", label: "Remove from Pitch List", danger: true,
    onSelect: async () => { if (confirm("Take this off the Pitch List?") && (await call("pitches.remove", { id: pitch.id }))) router.replace(campaignCrumb(campaign).href!); } }] : [];
  if (pitch && pitch.status !== "dropped") moreItems.push({ key: "abandon", testid: "pitch-abandon", label: "Abandon pitch", danger: true,
    onSelect: () => { if (confirm("Abandon this pitch? It moves to Past pitches.")) void call("pitches.move", { id: pitch.id, status: "dropped" }); } });
  const tabs = (details: string) => <Tabs<"pitch" | "details"> testid="place-tab" value={tab} onChange={setTab} options={[["pitch", "Pitch"], ["details", details]]} />;
  const body = tab === "pitch" && (
    <>
      {pitch ? <PitchBody key={pitch.id} id={pitch.id} embedded booking={booking} setBooking={setBooking} /> : (
        <section className="card" data-testid="place-no-pitch">
          <div className="card-head"><h2>No pitch here yet</h2></div>
          <span className="s">Start one to track lineup, dates, emails and the conversation.</span>
          <Flagged kind={kind} id={id} pitches={b.pitches} label="Start a pitch">{(button, form) => <div className="grid justify-items-start gap-2">{button}{form}</div>}</Flagged>
        </section>
      )}
      {past.length > 0 && <PastPitches pitches={past} other={!!pitch} />}
    </>
  );
  return { tab, tabs, body, crumb, pill, bookedIt, moreItems, pitch };
}

export function PastPitches({ pitches, other }: { pitches: PitchRow[]; other: boolean }) {
  return (
    <section className="card" data-testid="past-pitches">
      <div className="card-head"><h2>{other ? "Other pitches here" : "Past pitches here"}</h2></div>
      {pitches.map((p) => <Link key={p.id} href={`/booking/pitches/${p.id}`} className="flex flex-wrap items-center gap-2" data-testid={`past-pitch-${p.id}`}><StatusChip status={p.status} /><span className="s">{p.createdAt ? new Date(p.createdAt.toMillis()).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}</span></Link>)}
    </section>
  );
}

/** The header's right side: Booked it, then More (the pitch's items first, then the place's). */
export function PlaceMore({ bookedIt, items, testid }: { bookedIt: React.ReactNode; items: MenuItem[]; testid: string }) {
  return (
    <div className="flex items-center gap-2">
      {bookedIt}
      {items.length > 0 && <Menu label="More actions" testid={testid} trigger={<span className="px-1 text-lg font-bold leading-none" aria-hidden>⋮</span>} items={items} />}
    </div>
  );
}
