"use client";
import { BackLink } from "@/components/BackLink";
import { draftPath } from "@/schema/drafts";
import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, PickChip, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { AddressAutocomplete, type Place } from "@/components/AddressAutocomplete";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection } from "@/lib/firestore-hooks";
import { fmtPitchDate } from "@/lib/booking";
import { defaultProjectFor } from "@/components/tours/common";
import type { Musician, Pitch, Project } from "@/schema";

export default function NewTour() { return <AdminOnly><Suspense fallback={null}><Form /></Suspense></AdminOnly>; }

/** Pitches still in play: the ones a tour can start with. */
const OPEN_PITCH = new Set(["idea", "toPitch", "pitched", "talking"]);

interface NewTourForm {
  name: string; startDate: string; endDate: string; leavingFrom: Place | null; leavingText: string; billedAs: string;
  /** "" = the act's project (Duo or Band), else the default project. */
  projectId: string;
  personnel: string[];
  /** Pitches in the range start ticked; these were unticked. */
  skipPitchIds: string[];
  /** Pitches picked on the Pitch List (?pitchIds=): listed and ticked even without a date in the range. */
  pickPitchIds: string[];
}

/**
 * Create Tour: a draft (this device and the server) with an explicit "Create Tour" button, like Create Rehearsal. Nothing
 * auto-creates. A name is enough; tours.create puts the ticked pitches on it as options in the same step.
 */
function Form() {
  const router = useRouter();
  const { doc: artist, artistId } = useArtist();
  const params = useSearchParams();
  const { call, error, busy } = useCommand();
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const projects = useCollection<Project>("projects").rows ?? [];
  const pitches = useCollection<Pitch>("pitches", { where: [["artistId", "==", artistId]] }).rows ?? [];
  const draft = useDraft<NewTourForm>(draftPath.newIn("tours"),
    { name: "", startDate: "", endDate: "", leavingFrom: null, leavingText: "", billedAs: "", projectId: "", personnel: [], skipPitchIds: [], pickPitchIds: (params.get("pitchIds") ?? "").split(",").filter(Boolean) },
    { title: (v) => `New tour${v.name.trim() ? ` · ${v.name.trim()}` : ""}` });
  const v = draft.value;
  const set = (p: Partial<NewTourForm>) => draft.setValue({ ...v, ...p });
  const mutationId = useRef(newMutationId());
  const off = !draft.ready;
  // A draft from before keeps its values; pitches picked on the Pitch List this time are added to it, ticked.
  const urlPicks = params.get("pitchIds") ?? "";
  useEffect(() => {
    const add = urlPicks.split(",").filter((x) => x && !(v.pickPitchIds ?? []).includes(x));
    if (draft.ready && add.length) set({ pickPitchIds: [...(v.pickPitchIds ?? []), ...add], skipPitchIds: v.skipPitchIds.filter((x) => !add.includes(x)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.ready, urlPicks]);

  const open = projects.filter((p) => p.status !== "closed");
  const projectId = v.projectId || defaultProjectFor(artist, v.billedAs, open) || "";
  // Pitches offering a date in the range (both ends set), soonest first.
  const inRange = (d: string) => !!v.startDate && !!v.endDate && d >= v.startDate && d <= v.endDate;
  const picks = v.pickPitchIds ?? [];
  const offering = pitches.filter((p) => picks.includes(p.id) || (OPEN_PITCH.has(p.status) && !p.tourId && (p.dates ?? []).some(inRange)))
    .sort((a, b) => (a.dates.find(inRange) ?? "~") < (b.dates.find(inRange) ?? "~") ? -1 : 1);
  const ticked = offering.filter((p) => !v.skipPitchIds.includes(p.id));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await draft.settle();
    const r = await call<{ id: string }>("tours.create", {
      name: v.name.trim(), projectId,
      ...(v.startDate ? { startDate: v.startDate } : {}), ...(v.endDate ? { endDate: v.endDate } : {}),
      ...(v.leavingFrom ? { leavingFrom: v.leavingFrom } : {}), ...(v.billedAs ? { billedAs: v.billedAs } : {}),
      personnel: v.personnel,
      // Booked pitches bring their shows; the rest go on as options.
      pitchIds: ticked.filter((p) => p.showIds.length === 0).map((p) => p.id), showIds: ticked.flatMap((p) => p.showIds),
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.replace(`/tours/${r.id}`); }
  }

  return (
    <form className="grid gap-5" onSubmit={save} data-testid="new-tour-page">
      <PageTitle back={<BackLink href="/tours" label="All tours" />} title="Create Tour" sub="A name is enough. Dates, who's going and pitches can all come later." />
      {draft.ready && <div className="card grid max-w-3xl gap-3">
        <label className="grid gap-1"><span className="lbl">Name</span>
          <input className="input" value={v.name} onChange={(e) => set({ name: e.target.value })} required disabled={off} data-testid="tour-name-input" />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="grid gap-1"><span className="lbl">Starts <span className="s font-normal normal-case">(optional)</span></span>
            <input type="date" className="input" value={v.startDate} onChange={(e) => set({ startDate: e.target.value })} data-testid="tour-start" /></label>
          <label className="grid gap-1"><span className="lbl">Ends <span className="s font-normal normal-case">(optional)</span></span>
            <input type="date" className="input" value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} data-testid="tour-end" /></label>
        </div>
        <span className="s -mt-1.5">Leave them blank and the tour stretches to fit whatever you add.</span>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="grid gap-1"><span className="lbl">Leaving from</span>
            <AddressAutocomplete value={v.leavingText} testId="tour-leaving"
              onChange={(t) => set({ leavingText: t, leavingFrom: null })}
              onPick={(p) => set({ leavingFrom: p, leavingText: p.name ?? p.address })} /></div>
          <label className="grid gap-1"><span className="lbl">Act</span>
            <select className="select" value={v.billedAs} data-testid="tour-act"
              onChange={(e) => {
                const c = artist?.configurations.find((x) => x.id === e.target.value);
                set({ billedAs: e.target.value, ...(c ? { personnel: c.musicianIds } : {}) });
              }}>
              <option value="">Not set</option>
              {artist?.configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        </div>
        <label className="grid gap-1"><span className="lbl">Money goes to</span>
          <select className="select" value={projectId} onChange={(e) => set({ projectId: e.target.value })} data-testid="tour-project">
            {open.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <span className="s -mt-1.5">The project new money on this tour starts on. The tour is a tag: its totals count everything tagged with it, and the money still counts in its project.</span>
        <span className="lbl">Who&apos;s going</span>
        <div className="flex flex-wrap gap-1.5">
          {musicians.filter((m) => m.active || v.personnel.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
            const on = v.personnel.includes(m.id);
            return <PickChip key={m.id} on={on} testid={`tour-who-${m.name}`}
              onToggle={() => set({ personnel: on ? v.personnel.filter((x) => x !== m.id) : [...v.personnel, m.id] })}>{m.name}</PickChip>;
          })}
        </div>
        {((v.startDate && v.endDate) || offering.length > 0) && (
          <fieldset className="m-0 grid border-0 p-0" data-testid="tour-pitches">
            <legend className="lbl mb-0.5 p-0">Start with these pitches</legend>
            {v.startDate && v.endDate && <span className="s mb-1">Pitches offering dates between {fmtPitchDate(v.startDate)} and {fmtPitchDate(v.endDate)}</span>}
            {offering.length === 0 && <span className="d-muted">None yet.</span>}
            {offering.map((p) => (
              <label key={p.id} className="flex min-h-[44px] items-center gap-2.5 border-b border-divider last:border-b-0" data-testid={`tour-pitch-${p.target.name}`}>
                <input type="checkbox" className="h-[18px] w-[18px]" checked={!v.skipPitchIds.includes(p.id)}
                  onChange={(e) => set({ skipPitchIds: e.target.checked ? v.skipPitchIds.filter((x) => x !== p.id) : [...v.skipPitchIds, p.id] })} />
                <span><b>{p.target.name}</b> <span className="d-muted">· {(p.showIds.length > 0 ? "Booked" : p.dates.filter(inRange).map(fmtPitchDate).join(", ")) || "No dates in range"}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <div><button className="btn acc" disabled={busy || off || !v.name.trim() || !projectId} data-testid="create-tour">Create Tour</button></div>
        <ErrorBox error={error} />
      </div>}
    </form>
  );
}
