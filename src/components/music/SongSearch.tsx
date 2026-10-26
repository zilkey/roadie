"use client";
import { useRef, useState } from "react";

interface SongLike { id: string; title: string; status: string }

/**
 * Song typeahead over the library: type a few letters, pick a match (click, or Enter for the top one) and it's added.
 * Retired songs and the ones in `exclude` (already added) aren't offered. Each suggestion row gets song-search-option.
 */
export function SongSearch({ songs, exclude, onAdd, testid = "song-search" }: {
  songs: SongLike[]; exclude: string[]; onAdd(songId: string): void; testid?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const t = q.trim().toLowerCase();
  const skip = new Set(exclude);
  const hits = !t ? [] : songs
    .filter((s) => s.status !== "retired" && !skip.has(s.id) && s.title.toLowerCase().includes(t))
    // Titles that start with what was typed come first.
    .sort((a, b) => Number(!a.title.toLowerCase().startsWith(t)) - Number(!b.title.toLowerCase().startsWith(t)) || a.title.localeCompare(b.title))
    .slice(0, 8);

  function add(id: string) {
    onAdd(id);
    setQ(""); setHi(0); setOpen(false);
    input.current?.focus();
  }

  return (
    <div className="relative grid gap-1">
      <input ref={input} className="input" value={q} placeholder="Add a song…" autoComplete="off" aria-label="Add a song" role="combobox"
        aria-expanded={open && hits.length > 0} data-testid={testid}
        onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (hits[hi]) add(hits[hi].id); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && t && (
        <ul role="listbox" className="absolute top-full right-0 left-0 z-10 m-0 mt-1 grid list-none gap-0.5 rounded-[10px] border p-1 shadow-lg"
          style={{ background: "var(--surface)", borderColor: "var(--input-border)" }}>
          {hits.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === hi} data-testid="song-search-option">
              <button type="button" className={`min-h-[44px] w-full cursor-pointer rounded-md border-0 px-3 py-2 text-left ${i === hi ? "bg-soft" : "bg-transparent"}`}
                style={{ color: "var(--ink)", font: "inherit" }}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => add(s.id)}>
                {s.title}{s.status !== "active" && <span className="s"> · {s.status === "learning" ? "Learning" : "Idea"}</span>}
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="s px-3 py-2">No songs match.</li>}
        </ul>
      )}
    </div>
  );
}
