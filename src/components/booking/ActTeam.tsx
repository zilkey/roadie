"use client";
/**
 * "Find their team" on an act's Contacts card: looks for the act's booking agent, manager, publicist and label on its website and
 * a Google search (acts.findTeam), and lists who it found. Nothing is saved until Add, which makes them a contact linked to the act.
 */
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { TEAM_ROLE_LABEL, teamContactInput, teamSearchUrl, type TeamPerson, type TeamResult } from "@/lib/acts";
import type { Contact } from "@/schema";

import type { Row } from "@/lib/firestore-hooks";

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** The button, for the Contacts card's header. */
export function FindTeamButton({ busy, onClick }: { busy: boolean; onClick(): void }) {
  return (
    <button type="button" className="btn soft sm" disabled={busy} onClick={onClick} data-testid="act-find-team">
      {busy ? "Looking…" : "Find their team"}
    </button>
  );
}

/** What Find their team turned up, under the act's contacts. */
export function TeamFindings({ result, actId, actName, hasWebsite, linked, onClose }: {
  result: TeamResult; actId: string; actName: string; hasWebsite: boolean;
  /** The act's linked contacts, so someone already added says so. */
  linked: Row<Contact>[]; onClose(): void;
}) {
  const { call, error, busy } = useCommand();
  const [added, setAdded] = useState<Set<number>>(new Set());
  const isLinked = (p: TeamPerson) => linked.some((c) => (p.email && c.emails.includes(p.email)) || (p.name && c.name.toLowerCase() === p.name.toLowerCase()));
  const add = async (p: TeamPerson, i: number) => {
    const r = await call("contacts.create", { ...teamContactInput(p, actName), attachTo: { kind: "acts", id: actId } });
    if (r) setAdded((s) => new Set(s).add(i));
  };
  const where = `${result.read.length ? `${result.read.length} page${result.read.length === 1 ? "" : "s"}` : ""}${result.read.length && result.searched ? " and " : ""}${result.searched ? "a Google search" : ""}`;

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--divider)] p-3" data-testid="act-team">
      <div className="flex items-start justify-between gap-2">
        <span className="grid gap-0.5">
          <b>{result.people.length ? `Found ${result.people.length} on the web` : `Couldn't find ${actName}'s team`}</b>
          <span className="s">
            {result.people.length
              ? `From ${where || "the web"}. Check each one before you add them.`
              : `Nothing on ${where || "the web"} named a booking agent, manager or an email.`}
            {!hasWebsite && " Add their website under About and try again for a closer look."}
          </span>
        </span>
        <button type="button" className="btn ghost sm" aria-label="Close" onClick={onClose} data-testid="act-team-close">×</button>
      </div>
      <ErrorBox error={error} />
      {result.people.map((p, i) => {
        const done = added.has(i) || isLinked(p);
        return (
          <div key={`${p.email ?? p.name}-${i}`} className="flex flex-wrap items-center gap-3" data-testid={`act-team-person-${i}`}>
            <span className="grid min-w-0 flex-[1_1_240px] gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <b>{p.name ?? p.email}</b>
                <span className="chip">{TEAM_ROLE_LABEL[p.role]}</span>
                {p.company && <span className="s">{p.company}</span>}
              </span>
              {p.name && p.email && <span className="font-mono text-sm break-all">{p.email}</span>}
              {p.phone && <span className="s">{p.phone}</span>}
              <span className="s">{p.source ? <a href={p.source} target="_blank" rel="noreferrer">On {hostOf(p.source)} ↗</a> : "From a Google search"}</span>
            </span>
            {done
              ? <span className="chip a" data-testid={`act-team-added-${i}`}>In contacts</span>
              : <button type="button" className="btn acc sm" disabled={busy} onClick={() => void add(p, i)} data-testid={`act-team-add-${i}`}>Add</button>}
          </div>
        );
      })}
      {result.people.length === 0 && (
        <span><a className="btn ghost sm" href={teamSearchUrl(actName)} target="_blank" rel="noreferrer" data-testid="act-team-google">Search Google ↗</a></span>
      )}
    </div>
  );
}
