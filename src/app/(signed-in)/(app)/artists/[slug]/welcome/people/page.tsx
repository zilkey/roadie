"use client";
import NextLink from "next/link";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { FieldError, TextField } from "@/components/people/shared";
import { ErrorBox } from "@/components/ui";
import { useArtist } from "@/lib/artist";
import { CommandError, newMutationId, runCommand } from "@/lib/commands";
import { artistPath } from "@/lib/routes";
import { fieldErrors, personIssues, parseInstruments } from "@/schema";
import { useRouter } from "next/navigation";

export default function WelcomePeoplePage() { return <AdminOnly><Invite /></AdminOnly>; }

interface Row { key: string; name: string; role: "member" | "admin"; email: string; instruments: string; errors: Record<string, string>; mutationId: string }
let seq = 0;
const blank = (): Row => ({ key: `r${seq++}`, name: "", role: "member", email: "", instruments: "", errors: {}, mutationId: newMutationId() });
/** Role alone doesn't make a row "filled": it always has a value. */
const filled = (r: Row) => !!(r.name.trim() || r.email.trim() || r.instruments.trim());
/** The People page's rules for a Team person who is also a Band Member when instruments are given. */
const issuesOf = (r: Row) => fieldErrors(personIssues({ name: r.name, team: true, bandMember: !!r.instruments.trim(), instruments: r.instruments, email: r.email, role: r.role }));

/** Invite your band: the People page's Add person form repeated. Nothing is created until Add N people; no draft is kept. */
function Invite() {
  const artist = useArtist();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  const [runId] = useState(newMutationId);
  const count = rows.filter(filled).length;
  const links = artistPath(artist.slug, "/welcome/links");
  const ready = artistPath(artist.slug, "/welcome");

  const patch = (key: string, p: Partial<Row>, clear: string[] = []) =>
    setRows((rs) => rs.map((r) => r.key !== key ? r : { ...r, ...p, errors: Object.fromEntries(Object.entries(r.errors).filter(([k]) => !clear.includes(k))) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const todo = rows.filter(filled);
    const checked = rows.map((r) => (filled(r) ? { ...r, errors: issuesOf(r) } : { ...r, errors: {} }));
    if (checked.some((r) => Object.keys(r.errors).length)) {
      setRows(checked);
      return;
    }
    if (!todo.length) return;
    setBusy(true);
    const left: Row[] = [];
    let ok = 0;
    for (const r of checked) {
      if (!filled(r)) { left.push(r); continue; }
      const instruments = parseInstruments(r.instruments);
      try {
        // every row names the same run, so History shows one change and Undo removes them all
        await runCommand("users.add", { email: r.email.trim(), name: r.name.trim(), role: r.role, ...(instruments.length ? { musician: { instruments } } : {}) }, { clientMutationId: r.mutationId, runId });
        ok++;
      } catch (err) {
        const ce = err as CommandError;
        const mapped = ce.code === "invalid_input" && ce.issues?.length ? fieldErrors(ce.issues) : {};
        left.push({ ...r, errors: ce.status === 409 ? { email: "Already in the band" } : Object.keys(mapped).length ? mapped : { name: ce.message } });
      }
    }
    setBusy(false);
    if (!left.some(filled)) { router.push(links); return; }
    setAdded((n) => n + ok);
    setRows(left);
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto grid max-w-xl gap-4" data-testid="welcome-people">
      <div className="grid gap-1">
        <h1 className="page-title" data-testid="page-title">Invite your band</h1>
        <p className="s">They sign in with Google using this email. Nothing is emailed.</p>
      </div>
      <ErrorBox error={error} />
      {rows.map((r, i) => (
        <div key={r.key} className="card grid gap-3" data-testid={`invite-row-${i}`}>
          <TextField id={`inv-name-${r.key}`} label="Name" value={r.name} onChange={(v) => patch(r.key, { name: v }, ["name"])} error={r.errors.name} field="name" testid={`invite-name-${i}`} />
          <div className="grid gap-1">
            <label className="lbl" htmlFor={`inv-role-${r.key}`}>Access level</label>
            <select id={`inv-role-${r.key}`} className="select" value={r.role} onChange={(e) => patch(r.key, { role: e.target.value as Row["role"] }, ["role"])} data-testid={`invite-role-${i}`}>
              <option value="member">Standard</option>
              <option value="admin">Admin</option>
            </select>
            <FieldError id={`inv-role-${r.key}`} field="role" error={r.errors.role} />
          </div>
          <TextField id={`inv-email-${r.key}`} label="Google email" type="email" value={r.email} onChange={(v) => patch(r.key, { email: v }, ["email"])} error={r.errors.email} field="email" testid={`invite-email-${i}`} />
          <TextField id={`inv-instr-${r.key}`} label="Instruments" value={r.instruments} onChange={(v) => patch(r.key, { instruments: v }, ["instruments"])} error={r.errors.instruments} field="instruments" testid={`invite-instruments-${i}`} hint="Separate with commas. Leave blank for someone who isn't in the band lineup." />
        </div>
      ))}
      <button type="button" className="btn text" onClick={() => setRows((rs) => [...rs, blank()])} data-testid="invite-more">+ Add another</button>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn acc" disabled={busy || count === 0} data-testid="invite-add">{count === 1 ? "Add 1 person" : `Add ${count} people`}</button>
        {added > 0 && <NextLink href={links} className="btn" data-testid="invite-continue">Continue</NextLink>}
        <NextLink href={ready} className="btn text" data-testid="invite-skip">Skip for now</NextLink>
      </div>
    </form>
  );
}
