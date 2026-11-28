"use client";
import { useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { Link, useArtist } from "@/lib/artist";
import { showFieldValue } from "@/lib/show-fields";
import type { ShowField } from "@/schema";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, ShowCard } from "./kit";

/**
 * Custom fields: the artist's own per-show facts (Artist.showFields, defined under Admin > Custom fields), in the artist's order.
 * Admins only for now. A field with no default edits in place and saves the whole list (`shows.setFields`) when you leave it.
 * A field with a default (Settings › Custom fields) shows it, marked "Default"; "Override" opens a dialog to give this show its own
 * value, and an overridden one is marked "Overridden" with "Use default" in the same dialog. Free text; a blank value is no value.
 */
export function CustomFieldsCard({ show }: { show: ShowRow }) {
  const defs = useArtist().doc?.showFields ?? [];
  const { call, error, busy } = useCommand();
  const [editing, setEditing] = useState<ShowField | null>(null);
  const saved = Object.fromEntries((show.fields ?? []).map((v) => [v.fieldId, v.value]));

  const saveOne = async (fieldId: string, value: string) => {
    const next = { ...saved, [fieldId]: value };
    return !!(await call("shows.setFields", { id: show.id, fields: defs.filter((d) => next[d.id]?.trim()).map((d) => ({ fieldId: d.id, value: next[d.id].trim() })) }));
  };

  return (
    <ShowCard title="Custom fields" testid="custom-fields" badge={<AdminOnlyBadge />}>
      {defs.length === 0 ? (
        <p className="s m-0" data-testid="custom-fields-empty">No custom fields yet. <Link href="/admin/fields">Define some in settings</Link>.</p>
      ) : (
        <dl className="grid gap-3 m-0">
          {defs.map((d) => {
            const v = showFieldValue(d, show.fields);
            return (
              <div key={d.id} className="grid gap-0.5">
                <dt className="lbl">{d.label}</dt>
                <dd className="m-0">
                  {d.defaultValue ? (
                    <div className="flex flex-wrap items-baseline gap-2" data-testid={`custom-field-${d.id}`}>
                      <span className="whitespace-pre-wrap" data-testid={`custom-field-value-${d.id}`}>{v.value}</span>
                      <span className="chip" data-testid={`custom-field-state-${d.id}`}>{v.overridden ? "Overridden" : "Default"}</span>
                      <button type="button" className="btn text" aria-label={`${v.overridden ? "Change" : "Override"} ${d.label}`} data-testid={`custom-field-override-${d.id}`}
                        onClick={() => setEditing(d)}>{v.overridden ? "Change" : "Override"}</button>
                    </div>
                  ) : (
                    <InlineValue testid={`custom-field-${d.id}`} label={d.label} kind="text" value={saved[d.id] ?? ""} canEdit
                      onSave={(val) => saveOne(d.id, val)} error={error} />
                  )}
                  {d.description && <p className="s m-0" data-testid={`custom-field-help-${d.id}`}>{d.description}</p>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {editing && <OverrideDialog field={editing} own={saved[editing.id] ?? ""} busy={busy} error={error} onClose={() => setEditing(null)}
        onSave={async (val) => { if (await saveOne(editing.id, val)) setEditing(null); }} />}
    </ShowCard>
  );
}

/** Give this show its own value for a field with a default, or go back to the default (no value of its own). */
function OverrideDialog({ field, own, busy, error, onClose, onSave }: {
  field: ShowField; own: string; busy: boolean; error: string | null; onClose(): void; onSave(value: string): Promise<void>;
}) {
  const [value, setValue] = useState(own || field.defaultValue || "");
  const changed = value.trim() !== (field.defaultValue ?? "");
  return (
    <Dialog open onClose={onClose} title={`${field.label} for this show`} testid="custom-field-override">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void onSave(value); }}>
        <div className="grid gap-0.5">
          <span className="lbl">Default</span>
          <p className="s m-0 whitespace-pre-wrap" data-testid="custom-field-override-default">{field.defaultValue}</p>
        </div>
        <label className="grid gap-1">
          <span className="lbl">This show</span>
          <textarea className="input" rows={3} autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${field.label} for this show`} data-testid="custom-field-override-value" />
        </label>
        <ErrorBox error={error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {own ? <button type="button" className="btn text" disabled={busy} data-testid="custom-field-override-reset" onClick={() => void onSave("")}>Use default</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn text" onClick={onClose}>Cancel</button>
            <button className="btn acc" disabled={busy || !changed || !value.trim()} data-testid="custom-field-override-save">Save</button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
