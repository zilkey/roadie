"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { fmtLen } from "@/lib/music";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { Menu } from "@/components/Menu";
import { Missing, useMusic } from "@/components/music/common";
import { SetlistItemsEditor, itemsPayload, type SetlistItemT } from "@/components/music/SetlistItemsEditor";

export default function SetlistTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const t = m.templates.find((s) => s.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
  if (!t) return <Missing what="setlist template" />;
  return <View t={t} m={m} />;
}

/** The template editor: a reusable list of songs and breaks. A show's own setlist is edited on the show's Setlist tab. */
function View({ t, m }: { t: ReturnType<typeof useMusic>["templates"][number]; m: ReturnType<typeof useMusic> }) {
  const admin = useProfile().role === "admin";
  const router = useRouter();
  const { call, error, busy } = useCommand();
  // Existing record = autosave through setlistTemplates.update: the name saves as you type, list changes save at once (status + Undo toast).
  const as = useAutosave({ command: "setlistTemplates.update", id: t.id, rev: t.rev, title: t.name });
  const [items, setItems] = useState<SetlistItemT[]>(t.items);
  const serverKey = JSON.stringify(t.items);
  useEffect(() => { setItems(t.items); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next: SetlistItemT[]) => { setItems(next); as.patch({ items: itemsPayload(next) }, { now: true }); };

  return (
    <div className="grid gap-5" data-testid="setlist-page">
      <PageTitle
        back={<Link href="/setlists" className="back-link" data-testid="back">← All setlist templates</Link>}
        title={t.name}
        actions={admin ? <Menu label="More actions" testid="setlist" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>}
          items={[{ key: "archive", label: "Archive template", danger: true, disabled: busy, onSelect: async () => { if (confirm(`Archive ${t.name}?`) && (await call("setlistTemplates.remove", { id: t.id }))) router.push("/setlists"); } }]} /> : undefined} />
      <div className="cols">
        <div className="col-main">
          <SetlistItemsEditor items={items} onChange={save} songs={m.songs} admin={admin} empty="Nothing in this template yet." />
        </div>
        <div className="col-side">
          <div className="card" data-testid="setlist-total">
            <b className="font-mono text-xl" data-testid="total-time">{fmtLen(t.totalSec)}</b>
            <span className="s">{items.filter((i) => i.type === "song").length} songs</span>
          </div>
          {admin && (
            <div className="card">
              <div className="flex items-center gap-2">
                <input className="input" aria-label="Template name" data-testid="setlist-name" {...as.bind("name", t.name, { toPatch: (v) => v.trim() })} />
                <SaveStatus {...as.statusProps} />
              </div>
            </div>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
