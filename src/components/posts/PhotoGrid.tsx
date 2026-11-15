"use client";
import { useRef, useState } from "react";
import { PhotoViewer, ViewButton } from "@/components/posts/PhotoViewer";
import { dayTitle, type PhotoDay } from "@/lib/photoDays";
import { fmtDuration, isVideo } from "@/lib/photos";

/** A photo or video as posts.photos returns it. */
export interface GridPhoto {
  driveFileId: string; name: string; mimeType: string; width?: number; height?: number; durationMs?: number; takenAt: string; folderId: string; thumb: string;
}

/**
 * The inbox's photos and videos by day (a video marked with ▶ and its length), each day titled with its date and labelled with its shows and rehearsals. Picking is numbered:
 * `selected` is in tap order, which becomes the carousel's order. Click (or Space/Enter) toggles a photo, Shift-click adds
 * the range from the last photo clicked, and each day has Select all. The corner button on a photo opens it big (PhotoViewer),
 * where it can be picked too.
 */
export function PhotoGrid({ days, selected, onChange }: {
  days: PhotoDay<GridPhoto>[]; selected: string[]; onChange(next: string[]): void;
}) {
  const last = useRef<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const items = days.flatMap((d) => d.photos.map((p) => ({ id: p.driveFileId, name: p.name, thumb: p.thumb, video: isVideo(p.mimeType) })));
  const flat = items.map((p) => p.id);

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
            {/* As many columns as fit the grid's own width (not the window's: the column is narrow when Checklists and Roadie are open), so a tile is never smaller than 6.5rem. */}
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1 p-0 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] sm:gap-2">
              {d.photos.map((p) => {
                const n = selected.indexOf(p.driveFileId) + 1, video = isVideo(p.mimeType);
                return (
                  <li key={p.driveFileId} className="relative">
                    <button type="button" aria-pressed={n > 0} aria-label={`${p.name}${video ? ", video" : ""}${n ? `, picked ${n}` : ""}`} title={p.name}
                      onClick={(e) => toggle(p.driveFileId, e.shiftKey)}
                      className={`relative block aspect-square w-full overflow-hidden rounded-md bg-soft p-0 ${n ? "outline outline-3 outline-offset-[-3px] outline-[var(--accent)]" : ""}`}
                      data-testid={`photo-${p.driveFileId}`}>
                      <img src={p.thumb} alt="" loading="lazy" className={`h-full w-full object-cover ${n ? "opacity-80" : ""}`} />
                      {video && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-xs font-bold text-white" data-testid={`photo-video-${p.driveFileId}`}>
                          ▶{p.durationMs !== undefined ? ` ${fmtDuration(p.durationMs)}` : ""}
                        </span>
                      )}
                      {n > 0 && (
                        <span className="absolute right-1 top-1 grid h-6 min-w-6 place-items-center rounded-full bg-[var(--accent)] px-1 text-xs font-bold text-white" data-testid={`photo-pick-${p.driveFileId}`}>{n}</span>
                      )}
                    </button>
                    <ViewButton label={`See ${p.name} bigger`} onClick={() => setViewing(flat.indexOf(p.driveFileId))}
                      className="absolute bottom-1 right-1" testid={`photo-view-${p.driveFileId}`} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <PhotoViewer items={items} at={viewing} onAt={setViewing} action={(it) => {
        const n = selected.indexOf(it.id) + 1;
        return (
          <button type="button" className={`btn sm ${n ? "acc" : ""}`} aria-pressed={n > 0} onClick={() => toggle(it.id, false)} data-testid="photo-viewer-pick">
            {n ? `Picked · ${n}` : "Pick"}
          </button>
        );
      }} />
    </div>
  );
}
