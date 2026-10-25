"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { draftPath } from "@/schema/drafts";
import type { Show } from "@/schema";
import { useArtist } from "@/lib/artist";
import { newMutationId } from "@/lib/commands";
import { useDraft } from "@/lib/drafts";
import { useCollection } from "@/lib/firestore-hooks";
import { announceFansChanged } from "@/lib/fans-client";
import { fmtLong, showName } from "@/lib/shows";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { toast } from "@/components/Toasts";
import { ErrorBox, Select, useCommand } from "@/components/ui";

const blank = { email: "", firstName: "", city: "", showId: "" };

/**
 * "Add a fan" from a paper signup sheet: email, first name, city and the show they signed at. A draft (device + server) until Add is pressed;
 * Cancel throws the draft away. A draft left behind reopens the form. `open` is the page's "Add a fan" button.
 */
export function AddFan({ open, onOpen, onClose }: { open: boolean; onOpen(): void; onClose(): void }) {
  const { artistId } = useArtist();
  const { call, error, busy, setError } = useCommand();
  const d = useDraft(draftPath.newIn("fans"), blank, { route: "/fans", title: (v) => `New fan${v.email.trim() ? ` · ${v.email.trim()}` : ""}` });
  const mutationId = useRef(newMutationId());
  const shows = useCollection<Show>("shows", { where: [["artistId", "==", artistId]] });
  const options = useMemo(
    () => (shows.rows ?? []).filter((s) => s.status === "confirmed" || s.status === "played").sort((a, b) => b.date.localeCompare(a.date))
      .map((s) => [s.id, `${showName(s)} · ${fmtLong(s.date)}`] as const),
    [shows.rows]);
  const f = { ...blank, ...d.value };
  const started = !!(f.email || f.firstName || f.city || f.showId);
  // A draft from an earlier visit brings the form back on its own.
  useEffect(() => { if (d.ready && started && !open) onOpen(); }, [d.ready, started, open, onOpen]);
  const [problem, setProblem] = useState<string | null>(null);
  if (!d.ready || !open) return null;
  const set = (p: Partial<typeof blank>) => { setProblem(null); setError(null); d.setValue({ ...f, ...p }); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) { setProblem("Enter a valid email address."); document.getElementById("fan-add-email")?.focus(); return; }
    await d.settle();
    const r = await call<{ id: string; created: boolean }>("fans.add", {
      email: f.email.trim(), ...(f.firstName.trim() ? { firstName: f.firstName.trim() } : {}), ...(f.city.trim() ? { city: f.city.trim() } : {}), ...(f.showId ? { showId: f.showId } : {}),
    }, { clientMutationId: mutationId.current, clearDraft: d.draftId });
    if (!r) return;
    mutationId.current = newMutationId();
    await d.clear({ reset: true });
    toast({ key: "fan-added", text: r.created ? `Added ${f.email.trim()}.` : `${f.email.trim()} was already on the list. Their city and show were added.` });
    announceFansChanged();
    onClose();
  }
  async function cancel() { await d.clear({ reset: true }); setProblem(null); setError(null); onClose(); }

  return (
    <form onSubmit={submit} noValidate className="card" style={{ maxWidth: 760 }} data-testid="fan-add-form" aria-labelledby="fan-add-title">
      <h2 id="fan-add-title" className="card-h">Add a fan</h2>
      <p className="s">From a paper signup sheet. Only the email is needed.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1"><span className="lbl">Email</span>
          <input id="fan-add-email" className="input" type="email" autoComplete="off" value={f.email} aria-invalid={!!problem} onChange={(e) => set({ email: e.target.value })} data-testid="fan-add-email" /></label>
        <label className="grid gap-1"><span className="lbl">First name (optional)</span>
          <input className="input" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} data-testid="fan-add-first-name" /></label>
        <label className="grid gap-1"><span className="lbl">City (optional)</span>
          <input className="input" placeholder="Boise, ID" value={f.city} onChange={(e) => set({ city: e.target.value })} data-testid="fan-add-city" /></label>
        <label className="grid gap-1"><span className="lbl">Show (optional)</span>
          <Select value={f.showId} options={options} placeholder="No show" onChange={(v) => set({ showId: v })} testid="fan-add-show" label="Show" /></label>
      </div>
      {problem && <div className="err" role="alert" data-testid="fan-add-problem">{problem}</div>}
      <ErrorBox error={error} />
      <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
      <div className="flex flex-wrap gap-2">
        <button className="btn acc" disabled={busy} data-testid="fan-add-submit">Add</button>
        <button type="button" className="btn text" onClick={() => void cancel()} data-testid="fan-add-cancel">Cancel</button>
      </div>
    </form>
  );
}
