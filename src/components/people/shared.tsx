"use client";
import { useState } from "react";
import { CommandError, runCommand } from "@/lib/commands";
import { fieldErrors, mcpIn, roleIn, type Musician, type User } from "@/schema";
import type { Row } from "@/lib/firestore-hooks";

// ── Who is who ─────────────────────────────────────────────────────────────

/** One row of People: a Band Member (non-archived musician), Team access (a user in this artist), or both. Or an archived musician. */
export interface Person {
  id: string; key: string; name: string; email: string;
  u?: Row<User>; m?: Row<Musician>;
  band: boolean; role: "" | "admin" | "member"; mcp: boolean; archived: boolean; me: boolean;
}

export const MSG = {
  lastAdmin: "Roadie needs at least one Admin",
  lastBand: "The band needs at least one Band Member",
  ownTeam: "You can't remove your own Team access",
  demoteSelf: "You can't demote yourself",
} as const;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function derivePeople(users: Row<User>[], musicians: Row<Musician>[], artistId: string, myUid: string): Person[] {
  const team = users.filter((u) => { const r = roleIn(u, artistId); return r === "admin" || r === "member"; });
  const teamIds = new Set(team.map((u) => u.id));
  const used = new Set<string>();
  const out: Person[] = [];
  for (const u of team) {
    const m = musicians.find((x) => x.id === u.musicianId) ?? musicians.find((x) => x.userId === u.id);
    if (m) used.add(m.id);
    const role = roleIn(u, artistId) as "admin" | "member";
    out.push({ id: u.id, key: u.email || u.name, name: u.name || m?.name || u.email, email: u.email, u, m, band: !!m && !m.archivedAt, role, mcp: role === "admin" && mcpIn(u, artistId), archived: false, me: u.id === myUid });
  }
  for (const m of musicians) {
    if (used.has(m.id) || (m.userId && teamIds.has(m.userId))) continue;
    out.push({ id: m.id, key: m.email || m.name, name: m.name, email: m.email ?? "", m, band: !m.archivedAt, role: "", mcp: false, archived: !!m.archivedAt, me: false });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Why an action on this person is refused (the server enforces the same), or null. */
export function guards(p: Person, all: Person[]) {
  const admins = all.filter((x) => x.role === "admin").length;
  const bands = all.filter((x) => x.band).length;
  const lastAdmin = p.role === "admin" && admins <= 1;
  const lastBand = p.band && bands <= 1;
  return {
    demote: p.me ? MSG.demoteSelf : lastAdmin ? MSG.lastAdmin : null,
    removeTeam: p.me ? MSG.ownTeam : lastAdmin ? MSG.lastAdmin : null,
    removeBand: lastBand ? MSG.lastBand : null,
    archive: p.me ? MSG.ownTeam : lastAdmin ? MSG.lastAdmin : lastBand ? MSG.lastBand : null,
  };
}

// ── Commands ───────────────────────────────────────────────────────────────

/** Run a command; keeps a generic `error` (guards, duplicates) and per-field `fields` for invalid_input issues. */
export function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function act<T = { id?: string }>(name: string, input: unknown, meta?: { clientMutationId?: string; clearDraft?: string }): Promise<{ result: T } | null> {
    setBusy(true); setError(null); setFields({});
    try {
      return { result: await runCommand<T>(name, input, meta) };
    } catch (e) {
      const ce = e as CommandError;
      const mapped = ce.code === "invalid_input" && ce.issues?.length ? fieldErrors(ce.issues) : {};
      if (Object.keys(mapped).length) setFields(mapped); else setError(ce.message);
      return null;
    } finally { setBusy(false); }
  }
  const reset = () => { setError(null); setFields({}); };
  return { act, busy, error, fields, setFields, setError, reset };
}

// ── Pieces ─────────────────────────────────────────────────────────────────

export const AlertIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0"><circle cx="12" cy="12" r="9.5" /><path d="M12 7v6M12 16.5v.5" /></svg>;
const ic = (d: string) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d.split("|").map((p) => <path key={p} d={p} />)}</svg>;
export const Icons = {
  edit: ic("M4 20h4L19 9l-4-4L4 16z|M13.5 6.5l4 4"),
  trash: ic("M3 6h18|M8 6V4h8v2|M19 6l-1 14H6L5 6"),
  key: ic("M14 10a4 4 0 11-1 2.6L4 21v-3h3v-3h3l2.4-2.4"),
  band: ic("M9 18V6l10-2v12|M9 18a3 3 0 11-3-3 3 3 0 013 3zM19 16a3 3 0 11-3-3 3 3 0 013 3z"),
  signOut: ic("M15 4h4v16h-4|M10 8l-4 4 4 4|M6 12h10"),
  minus: ic("M5 12h14|M12 21a9 9 0 100-18 9 9 0 000 18z"),
  archive: ic("M3 5h18v4H3z|M5 9v10h14V9|M10 13h4"),
  restore: ic("M4 12a8 8 0 108-8 8 8 0 00-6 2.7|M4 4v4h4"),
};

export function FieldError({ id, field, error }: { id: string; field: string; error?: string }) {
  return error ? <p id={`${id}-err`} className="fe" data-testid={`error-${field}`}><AlertIcon />{error}</p> : null;
}
/** aria props for an input with an optional error (and hint) under it. */
export const invalid = (id: string, error?: string, hintId?: string) => ({
  "aria-invalid": error ? (true as const) : undefined,
  "aria-describedby": error ? `${id}-err` : hintId,
});

export function TextField({ id, label, value, onChange, error, field, testid, hint, placeholder, type, disabled, readOnly }: {
  id: string; label: string; value: string; onChange?(v: string): void; error?: string; field: string; testid: string; hint?: string;
  placeholder?: string; type?: string; disabled?: boolean; readOnly?: boolean;
}) {
  return (
    <div className="grid content-start gap-1">
      <label className="lbl" htmlFor={id}>{label}</label>
      <input id={id} className="input" type={type} value={value} placeholder={placeholder} disabled={disabled} readOnly={readOnly} data-testid={testid}
        onChange={(e) => onChange?.(e.target.value)} {...invalid(id, error, hint ? `${id}-hint` : undefined)} />
      {hint && <span id={`${id}-hint`} className="s">{hint}</span>}
      <FieldError id={id} field={field} error={error} />
    </div>
  );
}

export const Chips = ({ p }: { p: Person }) => (
  <>
    {p.band && <span className="chip m">Band Member</span>}
    {p.role && <span className="chip a">Team · {p.role === "admin" ? "Admin" : "Standard"}</span>}
  </>
);
