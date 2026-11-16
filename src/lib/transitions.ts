/**
 * The transition into a setlist item: what changes from the song above it (each song field marked "In setlists", by its
 * setlist label) and the band's own notes on getting there. Pure, so the editor and the printed sheets agree and it is unit tested.
 *
 * A transition belongs to the lower song (its transitionNote), so it moves with that song when the list is reordered.
 * The first item and breaks have none. A song right after a break gets notes only: the break resets everything, so
 * nothing is compared across it. Nothing is compared to or from an off-library song (no song, no field values).
 */
import type { SongField } from "@/schema";

export interface TransitionItem { type: "song" | "break"; songId?: string; transitionNote?: string }
export interface TransitionSong { id: string; fields?: { fieldId: string; value: string }[] }
export interface TransitionChange { fieldId: string; label: string; from: string; to: string }
export interface Transition { changes: TransitionChange[]; afterBreak: boolean; note: string }

/** What an empty value reads as: "Ingrid Plays: Acoustic → nothing". */
export const NOTHING = "nothing";

const valueOf = (s: TransitionSong | undefined, fieldId: string) => s?.fields?.find((f) => f.fieldId === fieldId)?.value?.trim() ?? "";

/** The changes from `from` to `to` in the fields marked In setlists, in the artist's field order. */
export function fieldChanges(from: TransitionSong | undefined, to: TransitionSong | undefined, songFields: SongField[]): TransitionChange[] {
  if (!from || !to) return [];
  return songFields.filter((f) => f.inSetlists).flatMap((f) => {
    const a = valueOf(from, f.id), b = valueOf(to, f.id);
    return a === b ? [] : [{ fieldId: f.id, label: f.setlistLabel || f.label, from: a || NOTHING, to: b || NOTHING }];
  });
}

/** "Capo: 5 → 6" */
export const fmtChange = (c: TransitionChange) => `${c.label}: ${c.from} → ${c.to}`;

/** The transition into items[i], or null when it has none (the first item, or a break). */
export function transitionAt(items: TransitionItem[], i: number, songs: Map<string, TransitionSong> | TransitionSong[], songFields: SongField[]): Transition | null {
  const it = items[i], prev = items[i - 1];
  if (!it || !prev || it.type !== "song") return null;
  const byId = songs instanceof Map ? songs : new Map(songs.map((s) => [s.id, s]));
  const note = it.transitionNote?.trim() ?? "";
  if (prev.type === "break") return { changes: [], afterBreak: true, note };
  const a = prev.songId ? byId.get(prev.songId) : undefined, b = it.songId ? byId.get(it.songId) : undefined;
  return { changes: fieldChanges(a, b, songFields), afterBreak: false, note };
}
