"use client";
import { useCallback, useEffect, useState } from "react";
import { runCommand } from "@/lib/commands";
import { announceFansChanged, type BandzoogleGroup } from "@/lib/fans-client";
import { Dialog, ErrorBox } from "@/components/ui";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } finally { t.remove(); }
  }
}

/** "Send to Bandzoogle": the fans not yet added, grouped by city. Copy a group, paste it into Bandzoogle's importer, then Mark as added. */
export function BandzoogleDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [groups, setGroups] = useState<BandzoogleGroup[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setGroups((await runCommand<{ groups: BandzoogleGroup[] }>("fans.forBandzoogle", {})).groups); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "error"); }
  }, []);
  useEffect(() => { if (open) { setGroups(null); void load(); } }, [open, load]);

  async function mark(g: BandzoogleGroup) {
    setBusy(g.group); setError(null);
    try { await runCommand("fans.markSynced", { group: g.group }); await load(); announceFansChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : "error"); }
    finally { setBusy(null); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Send to Bandzoogle" testid="bandzoogle-dialog">
      <p className="s">In Bandzoogle&apos;s mailing list members, choose Import, then Copy and paste your list. Pick the city&apos;s group, paste, import. Then mark the group as added.</p>
      <ErrorBox error={error} />
      {groups === null ? <span className="s">Loading…</span> : !groups.length ? <p data-testid="bandzoogle-empty">Everyone is already in Bandzoogle.</p> : (
        <ul className="grid gap-2">
          {groups.map((g) => (
            <li key={g.group} className="grid gap-2 rounded-xl border border-border p-3" data-testid="bandzoogle-group" data-group={g.group}>
              <div className="flex flex-wrap items-center gap-2">
                <b className="min-w-0 flex-1" data-testid="bandzoogle-group-name">{g.group} · {g.count}</b>
                <button type="button" className="btn acc sm" data-testid="bandzoogle-copy" onClick={async () => { await copyText(g.csv); setCopied(g.group); setTimeout(() => setCopied((c) => (c === g.group ? null : c)), 1500); }}>{copied === g.group ? "Copied" : "Copy"}</button>
                <button type="button" className="btn outline sm" disabled={busy !== null} data-testid="bandzoogle-mark" onClick={() => void mark(g)}>Mark as added</button>
              </div>
              <span className="s break-words" data-testid="bandzoogle-emails">{g.csv}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="s">Group names match city names, so imports land in the same place every time.</p>
      <div className="flex justify-end"><button type="button" className="btn" onClick={onClose} data-testid="bandzoogle-done">Done</button></div>
    </Dialog>
  );
}
