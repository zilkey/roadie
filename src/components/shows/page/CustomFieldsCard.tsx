"use client";
import { useState } from "react";
import { useCommand } from "@/components/ui";
import { Link, useArtist } from "@/lib/artist";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, EditableCard, useCardEdit } from "./kit";

/**
 * Custom fields: the artist's own per-show facts (Artist.showFields, defined under Admin > Custom fields), in the artist's order.
 * Admins only for now. Free text; a blank value is no value (no entry is stored). With no fields defined it points at where to define them.
 */
export function CustomFieldsCard({ show }: { show: ShowRow }) {
  const defs = useArtist().doc?.showFields ?? [];
  const { call, error, busy } = useCommand();
  const saved = Object.fromEntries((show.fields ?? []).map((v) => [v.fieldId, v.value]));
  const [vals, setVals] = useState<Record<string, string>>({});
  const ed = useCardEdit({ canEdit: defs.length > 0, onStart: () => setVals(saved) });

  const save = async () => !!(await call("shows.setFields", { id: show.id, fields: defs.filter((d) => vals[d.id]?.trim()).map((d) => ({ fieldId: d.id, value: vals[d.id].trim() })) }));

  return (
    <EditableCard title="Custom fields" testid="custom-fields" ed={ed} badge={<AdminOnlyBadge />} onSave={save} busy={busy} error={error}>
      {defs.length === 0 ? (
        <p className="s m-0" data-testid="custom-fields-empty">No custom fields yet. <Link href="/admin/fields">Define some in settings</Link>.</p>
      ) : ed.editing ? (
        <div className="grid gap-4">
          {defs.map((d) => (
            <div key={d.id} className="grid gap-1.5">
              <label htmlFor={`cf-${d.id}`} className="lbl">{d.label}</label>
              <input id={`cf-${d.id}`} className="input" value={vals[d.id] ?? ""} onChange={(e) => setVals({ ...vals, [d.id]: e.target.value })} data-testid={`custom-field-input-${d.id}`} />
            </div>
          ))}
        </div>
      ) : (
        <dl className="grid gap-3 m-0">
          {defs.map((d) => (
            <div key={d.id} className="grid gap-0.5">
              <dt className="lbl">{d.label}</dt>
              <dd className="m-0" data-testid={`custom-field-${d.id}`}>{saved[d.id]?.trim() || <span className="d-muted">—</span>}</dd>
            </div>
          ))}
        </dl>
      )}
    </EditableCard>
  );
}
