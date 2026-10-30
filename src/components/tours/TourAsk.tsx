"use client";
import { useRef, useState } from "react";
import { Dialog, ErrorBox, PickChip, useCommand } from "@/components/ui";
import { Sent, type AskResult } from "@/components/shows/Availability";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { draftPath } from "@/schema/drafts";
import { askDatesPhrase } from "@/lib/shows";
import { fmtPitchDate } from "@/lib/booking";
import { dateRange } from "@/lib/tours";
import type { Row } from "@/lib/firestore-hooks";
import type { Musician } from "@/schema";
import type { TourRow } from "./common";

/**
 * "Ask who's free" on a tour: one ask (availability.ask) over the tour's days, to the people going unless changed. It emails
 * people, so its inputs are a draft per tour until Send. Needs the tour's dates.
 */
export function TourAsk({ tour, musicians }: { tour: TourRow; musicians: Row<Musician>[] }) {
  const [open, setOpen] = useState(false);
  const days = tour.startDate && tour.endDate ? dateRange(tour.startDate, tour.endDate) : [];
  return (
    <>
      <button type="button" className="btn outline" disabled={!days.length} title={days.length ? undefined : "Set the tour's dates first"}
        onClick={() => setOpen(true)} data-testid="tour-ask">Ask who&apos;s free</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Ask who's free" testid="tour-ask-dialog">
        <AskForm tour={tour} days={days} musicians={musicians} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function AskForm({ tour, days, musicians, onClose }: { tour: TourRow; days: string[]; musicians: Row<Musician>[]; onClose(): void }) {
  const { call, error, busy } = useCommand();
  const draft = useDraft(draftPath.newUnder("tours", tour.id, "availability"),
    { dates: null as string[] | null, picked: null as string[] | null, msg: null as string | null }, { title: () => `Ask who's free · ${tour.name}` });
  const mutationId = useRef(newMutationId());
  const [result, setResult] = useState<AskResult | null>(null);
  const dates = (draft.value.dates ?? days).filter((d) => days.includes(d));
  const picked = draft.value.picked ?? tour.personnel;
  const msg = draft.value.msg ?? `Can you make ${tour.name} on ${askDatesPhrase(dates)}? Tap here to say if you're available.`;
  const set = (v: Partial<typeof draft.value>) => draft.setValue({ ...draft.value, ...v });

  async function send() {
    await draft.settle();
    const r = await call<AskResult>("availability.ask", { dates, musicianIds: picked, label: tour.name, message: msg }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r) { setResult(r); mutationId.current = newMutationId(); await draft.clear({ reset: true }); }
  }

  if (result) return <><Sent r={result} /><button type="button" className="btn acc justify-self-end" onClick={onClose}>Done</button></>;
  if (!draft.ready) return null;
  return (
    <div className="grid gap-3" data-testid="tour-ask-form">
      <span className="lbl">Dates</span>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const on = dates.includes(d);
          return <PickChip key={d} on={on} testid={`tour-ask-date-${d}`} onToggle={() => set({ dates: on ? dates.filter((x) => x !== d) : days.filter((x) => x === d || dates.includes(x)) })}>{fmtPitchDate(d)}</PickChip>;
        })}
      </div>
      <span className="lbl">People</span>
      <div className="flex flex-wrap gap-1.5">
        {musicians.filter((m) => m.active || picked.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
          const on = picked.includes(m.id);
          return <PickChip key={m.id} on={on} testid={`tour-ask-person-${m.name}`} onToggle={() => set({ picked: on ? picked.filter((x) => x !== m.id) : [...picked, m.id] })}>{m.name}</PickChip>;
        })}
      </div>
      <label className="grid gap-1"><span className="lbl">Message</span>
        <textarea className="input" rows={3} value={msg} onChange={(e) => set({ msg: e.target.value })} data-testid="tour-ask-message" /></label>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn outline" onClick={onClose}>Close</button>
        <button type="button" className="btn acc" disabled={busy || !dates.length || !picked.length || !msg.trim()} onClick={send} data-testid="tour-ask-send">Send</button>
      </div>
    </div>
  );
}
