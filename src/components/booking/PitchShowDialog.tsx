"use client";
/**
 * "Pitch this" on a venue-calendar show (#79, booking canvas board CalendarsPitch): the dialog asks what we're asking for (to open
 * for the headliner, or another night), then venueEvents.pitch starts the venue's pitch with the show's date, sets our take to
 * Pitched and links the pitch to the show. "Also reach out to X about opening" goes on to the headliner's act page, where Pitch
 * them writes to the act: local headliners often pick their own openers.
 */
import { useEffect, useRef, useState } from "react";
import { useArtistRouter as useRouter } from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { eventTime, fmtEventDay } from "@/lib/venueEvents";
import type { Ev } from "@/components/booking/VenueEventBits";

export interface PitchShow { e: Ev; venueName: string }

/** The headliner of a show: its first headliner act, else the listed title. */
const headlinerOf = (e: Ev) => e.acts.find((a) => a.role === "headliner") ?? null;

/** The "Pitch this" button: opens the dialog. Hidden once the show is pitched (the row then says Pitched). */
export function PitchThisButton({ e, onOpen }: { e: Ev; onOpen(e: Ev): void }) {
  return <button type="button" className="btn soft sm" onClick={() => onOpen(e)} data-testid={`pitch-this-${e.id}`}>Pitch this</button>;
}

/** `show === null` is closed. */
export function PitchShowDialog({ show, onClose }: { show: PitchShow | null; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = !!show;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="pitch-dlg" aria-labelledby="pitch-show-title" onCancel={(ev) => { ev.preventDefault(); onClose(); }}
      onClick={(ev) => { if (ev.target === ref.current) onClose(); }}>
      {show && <PitchShowForm key={show.e.id} show={show} onClose={onClose} />}
    </dialog>
  );
}

function PitchShowForm({ show: { e, venueName }, onClose }: { show: PitchShow; onClose(): void }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const head = headlinerOf(e);
  const name = head?.name ?? e.title;
  const [ask, setAsk] = useState<"open" | "another">("open");
  const [reach, setReach] = useState(true);
  const day = fmtEventDay(e.date), time = eventTime(e);
  const canReach = ask === "open" && !!head?.actId;

  async function start(ev: React.FormEvent) {
    ev.preventDefault();
    const r = await call<{ pitchId: string }>("venueEvents.pitch", { eventId: e.id, ask });
    if (!r) return;
    onClose();
    if (canReach && reach) router.push(`/booking/acts/${head!.actId}`);
  }

  return (
    <form onSubmit={start} className="grid gap-[14px]" style={{ padding: 22 }} data-testid="pitch-show-form">
      <h2 id="pitch-show-title" className="text-[1.375rem] font-extrabold leading-[1.3]">Pitch {venueName} for {day}</h2>
      <span className="s">Starts a pitch for {venueName} with this date. It opens on the venue page, where you write and send it as usual.</span>
      <div className="grid gap-1.5">
        <span className="lbl">Show</span>
        <span data-testid="pitch-show-show"><b>{name}</b> · {day}{time ? `, ${time}` : ""}</span>
      </div>
      <label className="grid gap-1.5">
        <span className="lbl">We&apos;re asking to</span>
        <select className="select" value={ask} onChange={(ev) => setAsk(ev.target.value as "open" | "another")} data-testid="pitch-show-ask">
          <option value="open">Open for {name}</option>
          <option value="another">Play another night</option>
        </select>
      </label>
      {canReach && (
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={reach} onChange={(ev) => setReach(ev.target.checked)} data-testid="pitch-show-reach" />
          <span>Also reach out to {name} about opening<span className="s block">Opens their act page: contacts, website, Instagram</span></span>
        </label>
      )}
      <ErrorBox error={error} />
      <div className="flex flex-wrap justify-end gap-[10px]">
        <button type="button" className="btn ghost" onClick={onClose} data-testid="pitch-show-cancel">Cancel</button>
        <button type="submit" className="btn acc" disabled={busy} data-testid="pitch-show-start">Start pitch</button>
      </div>
    </form>
  );
}
