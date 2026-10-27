"use client";
import { useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { Link, useArtist } from "@/lib/artist";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, ShowCard } from "./kit";

/**
 * Custom fields: the artist's own per-show facts (Artist.showFields, defined under Admin > Custom fields), in the artist's order.
 * Admins only for now. No flip: each value edits in place and saves the whole list (`shows.setFields`) when you leave it.
 * Free text; a blank value is no value (no entry is stored). With no fields defined it points at where to define them.
 */
export function CustomFieldsCard({ show }: { show: ShowRow }) {
  const defs = useArtist().doc?.showFields ?? [];
  const { call, error } = useCommand();
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
          {defs.map((d) => (
            <div key={d.id} className="grid gap-0.5">
              <dt className="lbl">{d.label}</dt>
              <dd className="m-0">
                <InlineValue testid={`custom-field-${d.id}`} label={d.label} kind="text" value={saved[d.id] ?? ""} canEdit
                  onSave={(v) => saveOne(d.id, v)} error={error} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </ShowCard>
  );
}
