"use client";
import { useRef, useState } from "react";
import { useArtist } from "@/lib/artist";
import { ErrorBox, Select, useCommand } from "@/components/ui";
import { newMutationId } from "@/lib/commands";
import { useCollection } from "@/lib/firestore-hooks";
import type { PitchRow } from "@/components/booking/common";
import { fmtPitchDate, sortedDates } from "@/lib/booking";
import { calendarInvitees } from "@/lib/shows";
import { celebrateBooking } from "@/components/Celebrate";
import type { Musician, User } from "@/schema";

/**
 * "Booked it! Turn this pitch into a show": which of the pitch's dates (or another one), the final configuration (starts as the pitch's)
 * and whether to copy the comments. Nothing happens until Create show; the pitch then moves to Past pitches as "Became a show".
 */
export function BookedItForm({ p, commentCount, onCancel }: { p: PitchRow; commentCount: number; onCancel(): void }) {
  const { doc: artist } = useArtist();
  const { call, error, busy } = useCommand();
  const dates = sortedDates(p.dates);
  const [date, setDate] = useState(dates[0] ?? "other");
  const [other, setOther] = useState("");
  const [cfg, setCfg] = useState(p.pitchedAs ?? "");
  const [copy, setCopy] = useState(true);
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const users = useCollection<User>("users").rows ?? [];
  const [invite, setInvite] = useState<boolean | null>(null); // null = not touched: follows whether anyone would be invited
  const recipients = artist ? calendarInvitees(artist.configurations.find((c) => c.id === cfg)?.musicianIds ?? [], musicians, users, artist.id) : [];
  const sendInvites = recipients.length > 0 && (invite ?? true);
  const mutationId = useRef(newMutationId());
  const invalid = date === "other" && !other;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    const day = date === "other" ? other : date;
    const r = await call("shows.create", {
      pitchId: p.id, venueId: p.target.id, date: day, billedAs: cfg || null, sendInvites, copyPitchComments: copy && commentCount > 0,
    }, { clientMutationId: mutationId.current });
    if (r) celebrateBooking(p.target.name, [fmtPitchDate(day)]);
  }

  return (
    <form className="grid gap-4" onSubmit={create} aria-labelledby={`book-h-${p.id}`} data-testid="book-form">
      <div className="grid gap-1">
        <h3 id={`book-h-${p.id}`} className="m-0 text-[1.125rem] font-bold">Booked it! Turn this pitch into a show</h3>
        <p className="d-muted m-0 text-[0.875rem]">The pitch ends as “Became a show”.</p>
      </div>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="lbl mb-2 p-0">Which date?</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[...dates.map((d) => [d, fmtPitchDate(d)] as const), ["other", "Another date"] as const].map(([v, label]) => (
            <label key={v} className="pick" aria-pressed={date === v}>
              <input type="radio" name={`book-date-${p.id}`} className="m-0" checked={date === v} onChange={() => setDate(v)} data-testid={`book-date-${v}`} />{label}
            </label>
          ))}
          {date === "other" && <input className="input w-auto" type="date" aria-label="Other date" value={other} onChange={(e) => setOther(e.target.value)} data-testid="book-other-date" />}
        </div>
      </fieldset>
      <label className="grid max-w-xs gap-1">
        <span className="lbl">Final configuration</span>
        <Select<string> value={cfg} onChange={setCfg} placeholder="Not sure yet" label="Final configuration" testid="book-config"
          options={(artist?.configurations ?? []).map((c) => [c.id, c.name] as [string, string])} />
      </label>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start">
        <input type="checkbox" className="m-0 h-[18px] w-[18px]" checked={copy} onChange={(e) => setCopy(e.target.checked)} data-testid="book-copy" />
        Copy over comments <span className="s">({commentCount})</span>
      </label>
      <div className="grid gap-1" data-testid="book-invites">
        <label className={`inline-flex min-h-11 items-center gap-2.5 self-start ${recipients.length ? "cursor-pointer" : "opacity-60"}`}>
          <input type="checkbox" className="m-0 h-[18px] w-[18px]" checked={sendInvites} disabled={!recipients.length} onChange={(e) => setInvite(e.target.checked)} data-testid="book-invite" />
          Send calendar invitations
        </label>
        <p className="s m-0" data-testid="book-invite-list">
          {recipients.length
            ? <>Invites go to: {recipients.map((id) => musicians.find((m) => m.id === id)?.name ?? "Someone").join(", ")}, when you add the show to the band calendar</>
            : "Nobody would be invited: pick a configuration with band members who are on the team and have an email."}
        </p>
      </div>
      <ErrorBox error={error} />
      <div className="d-sep" />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onCancel} data-testid="book-cancel">Cancel</button>
        <button type="submit" className="btn acc" disabled={busy || invalid} data-testid="book-submit">Create show</button>
      </div>
    </form>
  );
}
