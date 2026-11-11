"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { DetailCard } from "@/components/booking/DetailCards";
import { useBooking } from "@/components/booking/common";
import { toast } from "@/components/Toasts";
import type { Status } from "@/components/google/shared";
import { runCommand } from "@/lib/commands";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { fmtLong } from "@/lib/shows";
import { sheetCsv, tourSheet, SHEET_COLUMNS, type SheetCell, type SheetEntry, type SheetLink, type SheetShow } from "@/lib/tourSheet";
import type { Show, TourEntry } from "@/schema";
import { EntryModal, type EntryKind } from "./EntryModal";
import type { TourRow } from "./common";

/**
 * The Sheet tab (the "Tour page · Sheet tab" board, #52): one row per day, read-only. A drive, stay or note opens the Plan
 * tab's modal (admins), a show its page, an option its pitch. Admins also see Open and the day's options, and No date yet.
 * Download CSV saves the rows the viewer sees. Copy to Google Sheets (admins) makes the tour's one linked sheet in the band
 * folder, the band version; after that Update sheet rewrites it, after a confirm. Members get Open in Google Sheets.
 */
export function TourSheet({ tour, admin }: { tour: TourRow; admin: boolean }) {
  const entriesQ = useCollection<TourEntry>(`tours/${tour.id}/entries`, admin ? {} : { where: [["visibility", "==", "band"]] });
  const entries = useMemo(() => entriesQ.rows ?? [], [entriesQ.rows]);
  const showsQ = useCollection<Show>("shows");
  const booking = useBooking();
  const sheet = useMemo(() => tourSheet(tour, entries as unknown as SheetEntry[], new Map((showsQ.rows ?? []).map((s) => [s.id, s as SheetShow])),
    new Map(booking.pitches.map((p) => [p.id, p])), { band: !admin }), [tour, entries, showsQ.rows, booking.pitches, admin]);
  const [open, setOpen] = useState<string | null>(null);
  const openEntry = open ? entries.find((e) => e.id === open) : undefined;

  const { call, error, busy } = useCommand();
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => { if (admin) runCommand<Status>("google.status", {}).then(setStatus, () => undefined); }, [admin]);
  const ready = !!status?.driveReady;
  const linked = tour.sheet;

  async function copy() {
    if (linked && !confirm(`Update the ${tour.name} sheet? This replaces everything in it with what's here, including changes made in Google Sheets.`)) return;
    const r = await call<{ url: string; made: boolean }>("tours.sheet", { id: tour.id });
    if (r) toast({ key: `tour-sheet:${tour.id}`, text: r.made ? "Copied to Google Sheets" : "Updated the Google Sheet" });
  }
  function download() {
    const url = URL.createObjectURL(new Blob([sheetCsv(sheet)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${tour.name}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {linked && <a href={linked.url} target="_blank" rel="noreferrer" className="btn outline sm" data-testid="sheet-open">Open in Google Sheets ›</a>}
      {admin && <button type="button" className="btn ghost sm" disabled={busy || !ready} onClick={() => void copy()} data-testid="sheet-copy">{linked ? "Update sheet" : "Copy to Google Sheets"}</button>}
      <button type="button" className="btn text sm" onClick={download} data-testid="sheet-csv">Download CSV</button>
    </div>
  );

  return (
    <DetailCard private title="Sheet" testid="tour-sheet" headerExtra={actions}>
      {linked && (
        <span className="text-[0.875rem] text-muted" data-testid="sheet-linked">
          Google Sheet &ldquo;{tour.name}&rdquo; in the band folder · updated {fmtLong(linked.updatedAt.slice(0, 10))} by {linked.updatedBy} · the band version (no options or open dates)
        </span>
      )}
      {admin && status && !ready && (
        <span className="text-[0.875rem] text-muted" data-testid="sheet-no-google">Copy to Google Sheets needs the band&apos;s Google account: connect it on <Link href="/admin/google" className="underline">Settings &gt; Google</Link>.</span>
      )}
      <ErrorBox error={error} />
      {sheet.rows.length === 0
        ? <div className="empty" data-testid="sheet-no-days">No days yet. Set the tour&apos;s dates on the Info tab.</div>
        : (
          <div className="ts-scroll">
            <table className="ts-table">
              <thead><tr>{SHEET_COLUMNS.filter((c) => c !== "Day").map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>
                {sheet.rows.map((r) => (
                  <tr key={r.date} data-testid={`sheet-row-${r.date}`}>
                    <td className="ts-date"><b>{r.label}</b><span>Day {r.n} of {r.of}</span></td>
                    <td>{r.town || <Dash />}</td>
                    <td><Cells cells={r.drive} admin={admin} onEntry={setOpen} /></td>
                    <td data-testid="sheet-show">
                      {r.open && <span className="ts-open" data-testid="sheet-open-day">Open</span>}
                      {r.options.map((o) => (
                        <Link key={o.link!.id} href={`/booking/pitches/${o.link!.id}`} className="ts-opt" data-testid="sheet-option">
                          <span className="tp-rank" aria-label={`Option ${o.rank}`}>{o.rank}</span><span><b>{o.text}</b><span className="ts-sub">{o.sub}</span></span>
                        </Link>
                      ))}
                      {!r.open && <Cells cells={r.show} admin={admin} onEntry={setOpen} bold />}
                    </td>
                    <td>{r.times.length ? r.times.map((t, i) => <span key={i} className={`ts-line${t === "Times not set" ? " text-muted" : ""}`}>{t}</span>) : <Dash />}</td>
                    <td>{r.set.length ? r.set.map((t, i) => <span key={i} className="ts-line">{t}</span>) : <Dash />}</td>
                    <td><Cells cells={r.sound} admin={admin} onEntry={setOpen} /></td>
                    <td><Cells cells={r.contact} admin={admin} onEntry={setOpen} /></td>
                    <td data-testid="sheet-stay">{r.noStay ? <span className="ts-nostay">No stay</span> : <Cells cells={r.stay} admin={admin} onEntry={setOpen} />}</td>
                    <td><Cells cells={r.notes} admin={admin} onEntry={setOpen} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {sheet.bucket.length > 0 && (
        <div className="text-[0.875rem] text-muted" data-testid="sheet-bucket">
          <b className="text-ink">No date yet:</b>{" "}
          {sheet.bucket.map((c, i) => <span key={c.link!.id}>{i > 0 && ", "}<Link href={`/booking/pitches/${c.link!.id}`}>{c.text}</Link></span>)}
        </div>
      )}
      <EntryModal target={openEntry ? { kind: openEntry.kind as EntryKind, tourId: tour.id, entry: openEntry as Row<TourEntry> } : null} admin={admin} onClose={() => setOpen(null)} />
    </DetailCard>
  );
}

const Dash = () => <span className="ts-dash">—</span>;

/** A cell's things, one per line: a show opens its page; a drive, stay or note opens its modal for admins and is just text for members. */
function Cells({ cells, admin, onEntry, bold }: { cells: SheetCell[]; admin: boolean; onEntry(id: string): void; bold?: boolean }) {
  if (!cells.length) return <Dash />;
  return <>{cells.map((c, i) => {
    const body = <>{bold ? <b>{c.text}</b> : c.text}{c.sub && <span className="ts-sub">{c.sub}</span>}</>;
    const l: SheetLink | undefined = c.link;
    if (l?.kind === "show") return <Link key={i} href={`/shows/${l.id}`} className="ts-cell">{body}</Link>;
    if (l?.kind === "entry" && admin) return <button key={i} type="button" className="ts-cell" onClick={() => onEntry(l.id)} data-testid="sheet-entry">{body}</button>;
    return <span key={i} className="ts-line">{body}</span>;
  })}</>;
}
