"use client";
import { useEffect, useRef, useState } from "react";
import { runCommand } from "@/lib/commands";
import { announceFansChanged, type FanRow } from "@/lib/fans-client";
import { cityLabel } from "@/lib/fans";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { SaveStatus } from "@/components/SaveStatus";
import type { SaveState } from "@/lib/autosave";

const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/** The first name, edited in place: saved 800ms after typing stops and on blur, as the other record pages do. */
function NameCell({ fan }: { fan: FanRow }) {
  const [v, setV] = useState(fan.firstName ?? "");
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(fan.firstName ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(v); latest.current = v;
  async function save() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = latest.current.trim();
    if (next === saved.current) return;
    setStatus("saving"); setError(null);
    try {
      await runCommand("fans.update", { id: fan.id, patch: { firstName: next || null } }, { autosave: true });
      saved.current = next; setStatus("saved");
    } catch (e) { setError(e instanceof Error ? e.message : "error"); setStatus("error"); }
  }
  useEffect(() => () => { if (timer.current) void save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-0.5">
      <input className="input" value={v} placeholder="First name" aria-label={`First name for ${fan.email}`} data-testid="fan-first-name" maxLength={60}
        onChange={(e) => { setV(e.target.value); setStatus("saving"); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void save(), 800); }}
        onBlur={() => void save()} />
      {status !== "idle" && <SaveStatus status={status} error={error} />}
    </div>
  );
}

/** Admins only: every fan, with the first name editable and a hard delete behind a confirm. */
export function FanList({ fans, showLabels }: { fans: FanRow[]; showLabels: Map<string, string> }) {
  const [gone, setGone] = useState<FanRow | null>(null);
  const { call, error, busy, setError } = useCommand();
  async function remove() {
    if (!gone) return;
    const r = await call("fans.remove", { id: gone.id });
    if (r) { setGone(null); announceFansChanged(); }
  }
  return (
    <div className="card flush" data-testid="fan-list">
      <table className="people-table">
        <thead><tr><th>Email</th><th>First name</th><th>Cities</th><th>Shows</th><th>Source</th><th>In Bandzoogle</th><th className="act"><span className="sr-only">Delete</span></th></tr></thead>
        <tbody>
          {fans.map((f) => (
            <tr key={f.id} data-testid="fan-row" data-email={f.email}>
              <td className="em" data-testid="fan-email">{f.email}</td>
              <td><NameCell fan={f} /></td>
              <td data-testid="fan-cities">{f.cities.map(cityLabel).join(" · ") || <span className="s">No city</span>}</td>
              <td className="s">{f.showIds.map((s) => showLabels.get(s) ?? "Deleted show").join(" · ") || "—"}</td>
              <td><span className="chip">{f.source === "paper" ? "Paper" : "Online"}</span></td>
              <td data-testid="fan-bandzoogle">{f.bandzoogle ? dateOf(f.bandzoogle.addedAt) : <span className="s">Not yet</span>}</td>
              <td className="act"><button type="button" className="btn outline danger sm" aria-label={`Delete ${f.email}`} data-testid="fan-delete" onClick={() => { setError(null); setGone(f); }}>Delete</button></td>
            </tr>
          ))}
          {!fans.length && <tr><td colSpan={7} className="s" data-testid="fan-empty">No fans yet. They sign up on your list page, or add one from a paper sheet.</td></tr>}
        </tbody>
      </table>
      <Dialog open={!!gone} onClose={() => setGone(null)} title={`Delete ${gone?.email ?? "this fan"}?`} testid="fan-delete-dialog">
        <p>They are removed from the list for good, with their history. This can&apos;t be undone.</p>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn text" onClick={() => setGone(null)} data-testid="fan-delete-cancel">Cancel</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()} data-testid="fan-delete-ok">Delete for good</button>
        </div>
      </Dialog>
    </div>
  );
}
