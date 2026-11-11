"use client";
import { useState } from "react";
import { useArtistRouter } from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { ModalHead, MoneyDialog } from "@/components/money/MoneyOutModal";
import type { Row } from "@/lib/firestore-hooks";
import { dayLabel } from "@/lib/tours";
import type { TourEntry } from "@/schema";

type Entry = Row<TourEntry>;
type Choice = "drop" | "keep" | "tellBooked";
export type BookTarget = { tourId: string; entry: Entry };

/**
 * Book an option (the "Book dialog" board): which of the pitch's dates they confirmed, what to do with the other pitches
 * that were options that day, and a stay. Nothing is written until "Book {day}" (tours.book), which lands on the new show.
 */
export function BookDialog({ target, entries, nameOf, cityOf, onClose }: {
  target: BookTarget | null; entries: Entry[]; nameOf(pitchId: string): string; cityOf(pitchId: string): string | undefined; onClose(): void;
}) {
  return (
    <MoneyDialog open={!!target} onClose={onClose} testid="book-dialog" title={target ? `Book ${nameOf(target.entry.pitchId!)}` : "Book"}>
      {target && <BookForm key={target.entry.id} target={target} entries={entries} nameOf={nameOf} cityOf={cityOf} onClose={onClose} />}
    </MoneyDialog>
  );
}

function BookForm({ target, entries, nameOf, cityOf, onClose }: {
  target: BookTarget; entries: Entry[]; nameOf(pitchId: string): string; cityOf(pitchId: string): string | undefined; onClose(): void;
}) {
  const { tourId, entry } = target;
  const pitchId = entry.pitchId!;
  const router = useArtistRouter();
  const { call, busy, error } = useCommand();
  const options = entries.filter((e) => e.kind === "option" && e.date);
  const mine = options.filter((e) => e.pitchId === pitchId).sort((a, b) => a.date! < b.date! ? -1 : 1);
  const [date, setDate] = useState(entry.date!);
  const [picks, setPicks] = useState<Record<string, Choice>>({});
  const hasStay = (d: string) => entries.some((e) => e.kind === "stay" && e.date === d);
  const [stay, setStay] = useState<boolean | null>(null);
  const othersOn = (d: string) => options.filter((e) => e.date === d && e.pitchId !== pitchId);
  const others = othersOn(date);
  const city = cityOf(pitchId);
  const addStay = stay ?? !hasStay(date);
  const gone = mine.filter((e) => e.date !== date).map((e) => dayLabel(e.date!));
  const n = mine.length;

  async function book() {
    const r = await call<{ showId: string }>("tours.book", { tourId, entryId: mine.find((e) => e.date === date)!.id, date, addStay,
      others: Object.fromEntries(others.map((o) => [o.pitchId!, picks[o.pitchId!] ?? "drop"])) });
    if (r) { onClose(); router.push(`/shows/${r.showId}`); }
  }

  return (
    <div data-testid="book-form">
      <ModalHead title={`Book ${nameOf(pitchId)}`} onClose={onClose} testid="book-close"
        sub={n > 1 ? `This pitch offered ${n} dates. Which one did they confirm?` : `This pitch offered ${dayLabel(date)}. Is that the one they confirmed?`} />
      <div className="grid gap-4" style={{ padding: "18px 22px" }}>
        <div className="grid gap-2" role="radiogroup" aria-label="Date">
          {mine.map((e) => {
            const also = othersOn(e.date!).map((o) => [nameOf(o.pitchId!), cityOf(o.pitchId!)].filter(Boolean).join(" · "));
            return (
              <label key={e.id} className="flex items-start gap-3" style={{ minHeight: 44 }}>
                <input type="radio" name="book-date" checked={date === e.date} onChange={() => { setDate(e.date!); setStay(null); }} data-testid={`book-date-${e.date}`} />
                <span className="grid"><b>{dayLabel(e.date!)}</b>
                  <span className="text-[0.875rem] text-muted">{also.length ? `Also an option that day: ${also.join(", ")}` : "No other options that day"}</span></span>
              </label>
            );
          })}
        </div>
        {others.map((o) => {
          const id = o.pitchId!;
          const v = picks[id] ?? "drop";
          const name = [nameOf(id), cityOf(id)].filter(Boolean).join(" · ");
          const day = dayLabel(date);
          return (
            <fieldset key={id} className="grid gap-1 border-0 p-0" data-testid={`book-other-${id}`}>
              <legend className="lbl">What about {name} on {day}?</legend>
              {([["drop", `Take it off ${day}, keep the pitch in the bucket`], ["keep", `Keep it as a backup on ${day}`], ["tellBooked", "Tell them we're booked that night"]] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-3" style={{ minHeight: 44 }}>
                  <input type="radio" name={`book-other-${id}`} checked={v === k} onChange={() => setPicks({ ...picks, [id]: k })} data-testid={`book-other-${id}-${k}`} />{l}
                </label>
              ))}
            </fieldset>
          );
        })}
        <label className="flex items-center gap-3" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={addStay} onChange={(e) => setStay(e.target.checked)} data-testid="book-stay" />
          {city ? `Add a stay in ${city} that night` : "Add a stay that night"}
        </label>
        <p className="text-[0.8125rem] text-muted">
          The pitch becomes a show in the same spot on the tour.{gone.length ? ` ${gone.join(", ")} ${gone.length === 1 ? "comes" : "come"} off.` : ""} You&apos;ll land on the new show to fill in the deal and times.
        </p>
        <ErrorBox error={error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-divider" style={{ padding: "14px 22px 20px" }}>
        <button type="button" className="btn ghost" onClick={onClose} data-testid="book-cancel">Cancel</button>
        <button type="button" className="btn acc" disabled={busy} onClick={() => void book()} data-testid="book-submit">Book {dayLabel(date)}</button>
      </div>
    </div>
  );
}
