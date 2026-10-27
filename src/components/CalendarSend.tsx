"use client";
import { useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { fmtLongYear, fmtTime } from "@/lib/shows";

interface Preview {
  calendar: { id: string; name: string };
  action: "create" | "update";
  unchanged: boolean;
  event: { title: string; start: string; end: string; allDay: boolean; timeZone: string; location: string; description: string };
  invitees: { name: string; email: string }[];
  noEmail: string[];
  existing: { id: string; title: string; start: string; end: string; allDay: boolean; location: string }[];
}

const day = (v: string) => v.slice(0, 10);
const time = (v: string) => fmtTime(v.slice(11, 16));
/** "Sat, Nov 7, 2026 · 6:00 pm – 10:00 pm", across midnight "… – Sun, Nov 8, 2026 1:00 am", or "Sat, Nov 7, 2026 · All day". */
export function eventWhen(e: Preview["event"]): string {
  if (e.allDay) return `${fmtLongYear(e.start)} · All day`;
  const end = day(e.end) === day(e.start) ? time(e.end) : `${fmtLongYear(day(e.end))} ${time(e.end)}`;
  return `${fmtLongYear(day(e.start))} · ${time(e.start)} – ${end}`;
}

/**
 * The calendar line on a show or rehearsal: whether it's on the band calendar, and for admins the button that opens a
 * preview of exactly what goes out (title, when, where, notes, who's invited) before anything is sent. Saving a show or
 * rehearsal never touches Calendar; only Send here (or Remove) does. When something is already on the band calendar that
 * day (added by hand), the preview offers to link to it instead of adding a second event.
 */
export function CalendarSend({ kind, id, eventId, admin, off, beforeOpen, testid }: {
  kind: "shows" | "rehearsals"; id: string; eventId?: string; admin: boolean;
  /** A canceled or dropped show: it can only come off the calendar. */
  off?: boolean;
  /** Save pending edits first, so the preview shows what's typed (autosave). */
  beforeOpen?(): Promise<unknown>;
  testid: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCommand();
  const act = useCommand();

  async function show() {
    setOpen(true); setPreview(null); setNote(null); act.setError(null);
    if (off) return;
    await beforeOpen?.();
    const p = await load.call<Preview>(`${kind}.calendarPreview`, { id });
    if (p) setPreview(p);
  }
  async function link(eventId: string) {
    const r = await act.call(`${kind}.calendarLink`, { id, eventId });
    if (!r) return;
    setOpen(false);
    setNote("Linked to the event already on the band calendar.");
  }
  async function send(on: boolean) {
    const r = await act.call<{ calendar: string }>(`${kind}.calendar`, { id, on });
    if (!r) return;
    setOpen(false);
    setNote(r.calendar === "removed" ? "Taken off the band calendar." : r.calendar === "created" ? "Sent to the band calendar." : "Calendar event updated.");
  }

  const what = kind === "shows" ? "show" : "rehearsal";
  return (
    <>
      <span data-testid={testid}>
        {eventId ? <>✓ On the band calendar</> : <>Not on the band calendar</>}
        {admin && !(off && !eventId) && <> · <button type="button" className="font-semibold underline" style={{ color: "var(--accent)" }} onClick={() => void show()} data-testid={`${testid}-open`}>
          {!eventId ? "Add to calendar…" : off ? "Remove from calendar…" : "Update calendar…"}
        </button></>}
        {note && <span role="status" data-testid={`${testid}-note`}> · {note}</span>}
      </span>
      <Dialog open={open} onClose={() => setOpen(false)} title={!eventId ? "Add to the band calendar" : off ? "Remove from the band calendar" : "Update the band calendar"} testid={`${testid}-dialog`}>
        {off ? (
          <p className="m-0">This {what} is off, so its event comes off the band calendar and everyone invited gets a cancellation.</p>
        ) : !preview ? (
          load.error ? <ErrorBox error={load.error} /> : <p className="s m-0">Loading…</p>
        ) : (
          <div className="grid gap-3" data-testid="cal-preview">
            <p className="s m-0">
              {preview.action === "create" ? "This goes" : "This updates the event"} on <b data-testid="cal-preview-calendar">{preview.calendar.name}</b>
              {preview.unchanged ? <span data-testid="cal-preview-unchanged">. Nothing changed since it was last sent.</span> : "."}
            </p>
            <dl className="m-0 grid gap-2.5">
              <div className="grid gap-0.5"><dt className="lbl">Title</dt><dd className="m-0 font-semibold" data-testid="cal-preview-title">{preview.event.title}</dd></div>
              <div className="grid gap-0.5"><dt className="lbl">When</dt><dd className="m-0" data-testid="cal-preview-when">{eventWhen(preview.event)}</dd></div>
              <div className="grid gap-0.5"><dt className="lbl">Where</dt><dd className="m-0" data-testid="cal-preview-where">{preview.event.location || <span className="s">No location</span>}</dd></div>
              <div className="grid gap-0.5"><dt className="lbl">Invites</dt><dd className="m-0" data-testid="cal-preview-invitees">
                {preview.invitees.length ? preview.invitees.map((p) => `${p.name} (${p.email})`).join(", ") : <span className="s">Nobody</span>}
                {!!preview.noEmail.length && <span className="s block" data-testid="cal-preview-no-email">Not invited, no email: {preview.noEmail.join(", ")}</span>}
              </dd></div>
              <div className="grid gap-0.5"><dt className="lbl">Notes</dt><dd className="m-0 whitespace-pre-line" data-testid="cal-preview-notes">{preview.event.description || <span className="s">None</span>}</dd></div>
            </dl>
            {!!preview.existing.length && (
              <div className="grid gap-2" data-testid="cal-existing">
                <p className="s m-0">Already on <b>{preview.calendar.name}</b> that day. If it&apos;s this {what}, link to it instead of adding another:</p>
                {preview.existing.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-2" data-testid="cal-existing-event">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{e.title || "(no title)"}</div>
                      <div className="s">{eventWhen({ ...e, timeZone: "", description: "" })}{e.location && ` · ${e.location}`}</div>
                    </div>
                    <button type="button" className="btn ghost" disabled={act.busy} onClick={() => void link(e.id)} data-testid="cal-link">Link to this event</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <ErrorBox error={act.error} />
        <div className="flex flex-wrap justify-end gap-2">
          {eventId && !off && <button type="button" className="btn text mr-auto" disabled={act.busy} onClick={() => void send(false)} data-testid="cal-remove">Remove from calendar</button>}
          <button type="button" className="btn ghost" onClick={() => setOpen(false)} data-testid="cal-cancel">Cancel</button>
          {off
            ? <button type="button" className="btn acc" disabled={act.busy} onClick={() => void send(false)} data-testid="cal-remove">Remove from calendar</button>
            : <button type="button" className="btn acc" disabled={act.busy || !preview} onClick={() => void send(true)} data-testid="cal-send">{preview?.action === "update" ? "Update event" : preview?.existing.length ? "Add a new event" : "Add to calendar"}</button>}
        </div>
      </Dialog>
    </>
  );
}
