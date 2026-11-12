"use client";
import { useRef } from "react";
import { dayTitle, type PhotoDay } from "@/lib/photoDays";

/** A photo as posts.photos returns it. */
export interface GridPhoto {
  driveFileId: string; name: string; mimeType: string; width?: number; height?: number; takenAt: string; folderId: string; thumb: string;
}

/**
 * The inbox's photos by day, each day titled with its date and labelled with its shows and rehearsals. Picking is numbered:
 * `selected` is in tap order, which becomes the carousel's order. Click (or Space/Enter) toggles a photo, Shift-click adds
 * the range from the last photo clicked, and each day has Select all.
 */
export function PhotoGrid({ days, selected, onChange }: {
  days: PhotoDay<GridPhoto>[]; selected: string[]; onChange(next: string[]): void;
}) {
  const last = useRef<string | null>(null);
  const flat = days.flatMap((d) => d.photos.map((p) => p.driveFileId));

  function toggle(id: string, shift: boolean) {
    const from = last.current ? flat.indexOf(last.current) : -1, to = flat.indexOf(id);
    if (shift && from >= 0 && to >= 0) {
      const range = (from <= to ? flat.slice(from, to + 1) : flat.slice(to, from + 1).reverse()).filter((x) => !selected.includes(x));
      onChange([...selected, ...range]);
    } else {
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    }
    last.current = id;
  }

  function selectDay(ids: string[]) {
    const all = ids.every((x) => selected.includes(x));
    onChange(all ? selected.filter((x) => !ids.includes(x)) : [...selected, ...ids.filter((x) => !selected.includes(x))]);
  }

  return (
    <div className="grid gap-5" data-testid="photo-grid">
      {days.map((d) => {
        const ids = d.photos.map((p) => p.driveFileId), allIn = ids.every((x) => selected.includes(x));
        const key = d.day ?? "none";
        return (
          <section key={key} className="grid gap-2" aria-labelledby={`day-${key}`} data-testid={`photo-day-${key}`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 id={`day-${key}`} className="m-0 font-display text-base font-bold">{dayTitle(d.day)}</h3>
              {d.labels.length > 0 && <span className="s" data-testid={`photo-day-label-${key}`}>{d.labels.join(" · ")}</span>}
              <button type="button" className="btn ghost sm ml-auto" onClick={() => selectDay(ids)} data-testid={`photo-day-all-${key}`}>
                {allIn ? "Clear day" : "Select all"}
              </button>
            </div>
            <ul className="m-0 grid list-none grid-cols-3 gap-1 p-0 sm:grid-cols-4 sm:gap-2 lg:grid-cols-6">
              {d.photos.map((p) => {
                const n = selected.indexOf(p.driveFileId) + 1;
                return (
                  <li key={p.driveFileId}>
                    <button type="button" aria-pressed={n > 0} aria-label={`${p.name}${n ? `, picked ${n}` : ""}`} title={p.name}
                      onClick={(e) => toggle(p.driveFileId, e.shiftKey)}
                      className={`relative block aspect-square w-full overflow-hidden rounded-md bg-soft p-0 ${n ? "outline outline-3 outline-offset-[-3px] outline-[var(--accent)]" : ""}`}
                      data-testid={`photo-${p.driveFileId}`}>
                      <img src={p.thumb} alt="" loading="lazy" className={`h-full w-full object-cover ${n ? "opacity-80" : ""}`} />
                      {n > 0 && (
                        <span className="absolute right-1 top-1 grid h-6 min-w-6 place-items-center rounded-full bg-[var(--accent)] px-1 text-xs font-bold text-white" data-testid={`photo-pick-${p.driveFileId}`}>{n}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
