/**
 * The tour's Sheet tab (#52), pure: one row per day of the tour (the Plan tab's days), and the same rows as CSV for Download
 * CSV and the linked Google Sheet. Members and the Google Sheet get the band version: no options, no "Open", no No date yet.
 */
import { addDays, fmtTime, showCity, showName, type ShowPlaceLike } from "./shows";
import { fmtDuration, setLengthOf } from "./duration";
import { byPosition, dayLabel, driveText, tourDays, type EntryLike, type TourLike } from "./tours";

/** What the sheet reads off a show. */
export interface SheetShow extends ShowPlaceLike {
  times?: { loadIn?: string; doors?: string; set?: string; setLengthSec?: number; setLength?: number };
  sound?: { provider: "venueProvided" | "bandProvided"; notes?: string };
  dayOfContact?: { name: string; phone?: string };
}
/** What the sheet reads off a pitch (admins). */
export interface SheetPitch { target: { name: string }; dates?: string[] }
/** The places a sheet entry carries (drives and stays). */
type Place = { name?: string; address: string };
export type SheetEntry = EntryLike & { from?: Place; address?: Place; checkIn?: string };

/** What a cell opens: the entry modal (drives, stays, notes), the show page, or the pitch. */
export type SheetLink = { kind: "entry"; id: string } | { kind: "show"; id: string } | { kind: "pitch"; id: string };
export interface SheetCell { text: string; sub?: string; link?: SheetLink }
export interface SheetOption extends SheetCell { rank: number }

export interface SheetRow {
  date: string; label: string; n: number; of: number; town: string;
  drive: SheetCell[]; show: SheetCell[];
  /** Admins: no show yet, the day's options instead. */
  open: boolean; options: SheetOption[];
  /** One per show that day. */
  times: string[]; set: string[]; sound: SheetCell[]; contact: SheetCell[];
  stay: SheetCell[]; noStay: boolean; notes: SheetCell[];
}
export interface TourSheet { rows: SheetRow[]; bucket: SheetCell[] }

export const SOUND_LABEL = { venueProvided: "Venue", bandProvided: "We bring" } as const;
const townOf = (p?: Place) => p?.name ?? p?.address.split(",")[0];
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The rows. `band` drops what members never see (options, Open, the No date yet bucket), for a member and for the Google
 * Sheet; members' entries are already the band's only. A stay shows on every night it covers; a night of the tour (not the
 * last) with no stay and no round trip home reads No stay. A day with nothing that says where it is keeps the day before's town.
 */
export function tourSheet(tour: TourLike, entries: readonly SheetEntry[], shows: ReadonlyMap<string, SheetShow>, pitches: ReadonlyMap<string, SheetPitch>, o: { band: boolean }): TourSheet {
  const live = entries.filter((e) => !e.deletedAt && !(o.band && (e.kind === "option" || e.visibility === "admins")));
  const { days, bucket } = tourDays(tour, live);
  const stays = byPosition(live.filter((e) => e.kind === "stay" && e.date));
  let town = "";
  const rows = days.map((d, i): SheetRow => {
    const on = (k: EntryLike["kind"]) => d.entries.filter((e) => e.kind === k);
    const dayShows = on("show").map((e) => ({ e, s: shows.get(e.showId!) }));
    const drives = on("drive"), options = on("option");
    const covering = stays.flatMap((s) => {
      const night = dayIndex(s.date!, d.date);
      return night >= 0 && night < (s.nights ?? 1) ? [{ s, night }] : [];
    });
    const lastDrive = drives[drives.length - 1];
    town = townOf(lastDrive?.to) || dayShows.map((x) => x.s && showCity(x.s)).find(Boolean) || townOf(covering[0]?.s.address) || town;
    const last = i === days.length - 1;
    return {
      date: d.date, label: dayLabel(d.date), n: i + 1, of: days.length, town,
      drive: drives.map((e) => ({
        text: [townOf(e.from), townOf(e.to)].filter(Boolean).join(" → ") + (e.roundTrip ? " and back" : "") || "Drive",
        sub: [driveText(e.minutes, e.miles), e.leaveBy && `leave by ${fmtTime(e.leaveBy)}`].filter(Boolean).join(" · ") || undefined,
        link: { kind: "entry", id: e.id },
      })),
      show: dayShows.map(({ e, s }) => ({ text: s ? showName(s) : "Show", sub: (s && showCity(s)) || undefined, link: { kind: "show", id: e.showId! } })),
      open: !o.band && !dayShows.length && options.length > 0,
      options: o.band || dayShows.length ? [] : options.map((e, r) => {
        const p = pitches.get(e.pitchId!);
        const also = (p?.dates ?? []).filter((x) => x !== d.date).map(dayLabel);
        return { rank: r + 1, text: p?.target.name ?? "Pitch", sub: [`Option ${r + 1} of ${options.length}`, also.length ? `also ${also.join(", ")}` : ""].filter(Boolean).join(" · "), link: { kind: "pitch", id: e.pitchId! } };
      }),
      times: dayShows.map(({ s }) => {
        const t = s?.times;
        return [t?.loadIn && `Load in ${fmtTime(t.loadIn)}`, t?.doors && `Doors ${fmtTime(t.doors)}`, t?.set && `Set ${fmtTime(t.set)}`].filter(Boolean).join(" · ") || "Times not set";
      }),
      set: dayShows.map(({ s }) => fmtDuration(s?.times ? setLengthOf(s.times) : undefined)).filter(Boolean),
      sound: dayShows.flatMap(({ s }) => s?.sound ? [{ text: SOUND_LABEL[s.sound.provider], sub: s.sound.notes || undefined }] : []),
      contact: dayShows.flatMap(({ s }) => s?.dayOfContact ? [{ text: s.dayOfContact.name, sub: s.dayOfContact.phone || undefined }] : []),
      stay: covering.map(({ s, night }) => ({
        text: s.name ?? "Stay",
        sub: [townOf(s.address), night === 0 ? plural(s.nights ?? 1, "night") : `night ${night + 1} of ${s.nights}`, night === 0 && s.checkIn && `check in ${fmtTime(s.checkIn)}`].filter(Boolean).join(" · "),
        link: { kind: "entry", id: s.id },
      })),
      noStay: !last && !covering.length && !drives.some((e) => e.roundTrip),
      notes: on("note").map((e) => ({ text: e.text ?? "", link: { kind: "entry", id: e.id } })),
    };
  });
  return {
    rows,
    bucket: o.band ? [] : bucket.map((e) => ({ text: pitches.get(e.pitchId!)?.target.name ?? "Pitch", link: { kind: "pitch", id: e.pitchId! } })),
  };
}

/** Which night of a stay starting `from` the date `d` is (0 = the first); negative before it. */
function dayIndex(from: string, d: string): number {
  let n = 0;
  for (let x = from; x < d && n < 400; x = addDays(x, 1)) n++;
  return from > d ? -1 : n;
}

// ---------- CSV ----------

export const SHEET_COLUMNS = ["Date", "Day", "Town", "Drive", "Show", "Times", "Set", "Sound", "Contact", "Stay", "Notes"] as const;

const line = (c: SheetCell) => [c.text, c.sub].filter(Boolean).join(" · ");
/** A cell's lines, one per thing, as one CSV field. A leading = + - @ would be a formula in Sheets: quote it as text. */
function field(v: string): string {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The rows as CSV, a header first: what Download CSV saves and what the Google Sheet holds. */
export function sheetCsv(sheet: TourSheet): string {
  const out = [SHEET_COLUMNS.join(",")];
  for (const r of sheet.rows) {
    const show = r.show.length ? r.show.map(line) : r.open ? ["Open", ...r.options.map(line)] : [];
    const cells = [r.label, `${r.n} of ${r.of}`, r.town, r.drive.map(line), show, r.times, r.set, r.sound.map(line), r.contact.map(line),
      r.noStay ? ["No stay"] : r.stay.map(line), r.notes.map(line)];
    out.push(cells.map((c) => field(Array.isArray(c) ? c.join("\n") : c)).join(","));
  }
  if (sheet.bucket.length) out.push(field(`No date yet: ${sheet.bucket.map((c) => c.text).join(", ")}`));
  return out.join("\r\n") + "\r\n";
}
