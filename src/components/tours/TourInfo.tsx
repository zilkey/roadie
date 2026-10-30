"use client";
import { useState } from "react";
import { useArtist } from "@/lib/artist";
import { CardGroup, DetailCard, KV } from "@/components/booking/DetailCards";
import { InlineValue, PenIcon } from "@/components/InlineValue";
import { AddressAutocomplete, type Place } from "@/components/AddressAutocomplete";
import { fmtLongYear } from "@/lib/shows";
import { TOUR_STATUS_LABEL } from "@/lib/tours";
import type { Row } from "@/lib/firestore-hooks";
import type { Musician, Project, TourStatus } from "@/schema";
import { townOf } from "./common";

/** The Info tab's editable fields of a tour, as the page holds them between saves. */
export interface TourForm {
  name: string; status: TourStatus; startDate: string; endDate: string; leavingFrom: Place | null; billedAs: string; projectId: string; personnel: string[]; notes: string;
}

/**
 * Info: Tour details (each value click-to-edit), Who's going (the rehearsal's Band members card; on a Done tour, Who came: a
 * read-only list of the tour's people) and Notes. Every change goes
 * through `save`, the page's autosave (tours.update), so it shows in SaveStatus and gets an Undo toast. Members read it.
 */
export function TourInfo({ form, admin, musicians, projects, save }: {
  form: TourForm; admin: boolean; musicians: Row<Musician>[]; projects: Row<Project>[];
  save(patch: Record<string, unknown>): Promise<boolean>;
}) {
  const artist = useArtist().doc;
  const configs = artist?.configurations ?? [];
  const open = projects.filter((p) => p.status !== "closed" || p.id === form.projectId);
  const active = musicians.filter((m) => m.active || form.personnel.includes(m.id));
  const done = form.status === "done";
  const came = musicians.filter((m) => form.personnel.includes(m.id));
  const fullBand = active.length > 0 && active.every((m) => form.personnel.includes(m.id));
  const toggle = (id: string) => void save({ personnel: form.personnel.includes(id) ? form.personnel.filter((x) => x !== id) : [...form.personnel, id] });

  return (
    <CardGroup kind="private">
      <DetailCard private title="Tour details" testid="tour-details-card">
        <KV rows={[
          ["Starts", <InlineValue key="s" testid="tour-start" label="Starts" kind="date" value={form.startDate} display={fmtLongYear(form.startDate)} canEdit={admin}
            onSave={(v) => save({ startDate: v || null })} />],
          ["Ends", <InlineValue key="e" testid="tour-end" label="Ends" kind="date" value={form.endDate} display={fmtLongYear(form.endDate)} canEdit={admin}
            onSave={(v) => save({ endDate: v || null })} />],
          ["Leaving from", <PlaceValue key="l" testid="tour-leaving" label="Leaving from" value={form.leavingFrom} canEdit={admin} onSave={(p) => save({ leavingFrom: p })} />],
          ["Act", <InlineValue key="a" testid="tour-act" label="Act" kind="select" value={form.billedAs} canEdit={admin}
            options={[["", "Not set"], ...configs.map((c) => [c.id, c.name] as const)]}
            onSave={(v) => { const c = configs.find((x) => x.id === v); return save({ billedAs: v || null, ...(c ? { personnel: c.musicianIds } : {}) }); }} />],
          ["Status", <InlineValue key="st" testid="tour-status" label="Status" kind="select" value={form.status} canEdit={admin}
            options={Object.entries(TOUR_STATUS_LABEL)} onSave={(v) => save({ status: v })} />],
          ["Money goes to", <span key="m" className="grid gap-0.5">
            <InlineValue testid="tour-project" label="Money goes to" kind="select" value={form.projectId} canEdit={admin}
              options={open.map((p) => [p.id, p.name] as const)} onSave={(v) => save({ projectId: v })} />
            <span className="text-[0.8125rem] d-muted">The project new money on this tour starts on. The tour is a tag: its totals count what&apos;s tagged with it, whatever the project.</span>
          </span>],
        ]} />
        <span className="text-[0.8125rem] d-muted">Dates are optional. Leave them blank and the tour stretches to fit what&apos;s on it; set them and Roadie warns about anything outside.</span>
      </DetailCard>

      {done ? (
        <DetailCard private title="Who came" testid="tour-who-card">
          {came.length === 0 ? <span className="d-muted">No one listed.</span> : (
            <ul className="m-0 grid list-none p-0">
              {came.map((x) => <li key={x.id} className="d-row" data-testid="tour-member-row"><Person m={x} /></li>)}
            </ul>
          )}
        </DetailCard>
      ) : (
      <DetailCard private title="Who's going" testid="tour-who-card" headerExtra={fullBand ? <span className="d-muted text-sm">Full band</span> : undefined}>
        <ul className="m-0 grid list-none p-0">
          {active.map((x) => (
            <li key={x.id} className="d-row" data-testid="tour-member-row">
              <Person m={x} />
              <label className="flex min-h-[44px] items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.personnel.includes(x.id)} disabled={!admin} onChange={() => toggle(x.id)} data-testid={`tour-coming-${x.name}`} />Coming
              </label>
            </li>
          ))}
        </ul>
      </DetailCard>
      )}

      <DetailCard private title="Notes" testid="tour-notes-card">
        {admin
          ? <InlineValue testid="tour-notes" label="Notes" kind="textarea" value={form.notes} canEdit onSave={(v) => save({ notes: v || null })} />
          : form.notes ? <p className="m-0 whitespace-pre-wrap">{form.notes}</p> : <span className="d-muted">No notes.</span>}
      </DetailCard>
    </CardGroup>
  );
}

/** A band member's initial, name and instruments. */
function Person({ m }: { m: Row<Musician> }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-soft text-sm font-bold">{m.name.charAt(0)}</span>
      <span className="min-w-0 font-semibold">{m.name}{m.instruments.length > 0 && <span className="d-muted font-normal"> · {m.instruments.join(", ")}</span>}</span>
    </span>
  );
}

/** Click to edit a town: the value is the button; tapping it opens the place search, picking a place saves it, leaving it empty clears it. */
function PlaceValue({ testid, label, value, canEdit, onSave }: { testid: string; label: string; value: Place | null; canEdit: boolean; onSave(p: Place | null): Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const shown = value ? value.name ?? value.address : "";
  if (!canEdit) return shown ? <span data-testid={testid}>{shown}</span> : <span className="d-muted" data-testid={testid}>—</span>;
  if (!editing) {
    return (
      <button type="button" className={`val${shown ? "" : " add"}`} aria-label={shown ? `Edit ${label}` : `Add… ${label}`} data-testid={testid}
        onClick={() => { setText(value ? townOf(value) ?? "" : ""); setEditing(true); }}>
        <span className="min-w-0">{shown || "Add…"}</span><PenIcon />
      </button>
    );
  }
  return (
    <span className="grid gap-1.5" data-testid={`${testid}-input`}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTimeout(() => { if (!text.trim() && value) void onSave(null); setEditing(false); }, 200); }}
      onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}>
      <AddressAutocomplete value={text} testId={`${testid}-search`} onChange={setText}
        onPick={async (p) => { if (await onSave(p)) setEditing(false); }} />
    </span>
  );
}
