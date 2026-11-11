"use client";
/**
 * "Find their team" on an act's Contacts card: looks for the act's booking agent, manager, publicist and label on its website and
 * a Google search (acts.findTeam), then searches for each person's own email and LinkedIn, and lists who it found. Nothing is saved
 * until Add, which makes them a contact linked to the act, with a note on how they were found. Someone already in the band's contacts
 * (same email, or the same name as teamContactMatch reads it) is never added twice: linked to this act they link to their page;
 * not linked yet, Link links them (contacts.attach). Either way "Add their info" fills in what the search found that they lack.
 */
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import Link from "@/lib/artist";
import { TEAM_ROLE_LABEL, teamContactInput, teamContactMatch, teamContactPatch, teamSearchUrl, type TeamPerson, type TeamResult } from "@/lib/acts";
import { todayStr } from "@/lib/booking";
import { ContactLinks, hrefFor, type Noted } from "@/components/booking/common";
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
export function TeamFindings({ result, actId, actName, hasWebsite, contacts, linkedIds, onClose }: {
  result: TeamResult; actId: string; actName: string; hasWebsite: boolean;
  /** All the band's contacts, so someone already in them is linked, not added again. */
  contacts: Noted<Row<Contact>>[];
  /** The act's linked contacts' ids. */
  linkedIds: string[]; onClose(): void;
}) {
  const { call, error, busy } = useCommand();
  const [added, setAdded] = useState<Map<number, string>>(new Map());
  const linked = contacts.filter((c) => linkedIds.includes(c.id));
  // A match among the act's own contacts wins over one elsewhere in the band's.
  const matchOf = (p: TeamPerson) => teamContactMatch(p, linked) ?? teamContactMatch(p, contacts);
  const link = (c: Noted<Row<Contact>>) => call("contacts.attach", { contactId: c.id, kind: "acts", id: actId });
  const add = async (p: TeamPerson, i: number) => {
    const r = await call<{ id: string }>("contacts.create", { ...teamContactInput(p, actName, todayStr()), attachTo: { kind: "acts", id: actId } });
    if (r) setAdded((s) => new Map(s).set(i, r.id));
  };
  const addInfo = (c: Noted<Row<Contact>>, patch: Record<string, unknown>) => call("contacts.update", { id: c.id, patch });
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
        const c = matchOf(p);
        const isLinked = !!c && linkedIds.includes(c.id);
        const contactId = c?.id ?? added.get(i);
        const patch = c && teamContactPatch(p, c, actName, todayStr());
        return (
          <div key={`${p.email ?? p.name}-${i}`} className="flex flex-wrap items-center gap-3" data-testid={`act-team-person-${i}`}>
            <span className="grid min-w-0 flex-[1_1_240px] gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                {contactId
                  ? <Link href={hrefFor("contact", contactId)} className="font-bold text-[var(--accent-text)] hover:underline" data-testid={`act-team-link-${i}`}>{p.name ?? p.email}</Link>
                  : <b>{p.name ?? p.email}</b>}
                <span className="chip">{TEAM_ROLE_LABEL[p.role]}</span>
                {p.company && <span className="s">{p.company}</span>}
              </span>
              {p.name && p.email && <span className="font-mono text-sm break-all">{p.email}</span>}
              {p.phone && <span className="s">{p.phone}</span>}
              {p.links?.length ? <ContactLinks links={p.links} testid={`act-team-links-${i}`} /> : null}
              <span className="s">
                {p.source ? <a href={p.source} target="_blank" rel="noreferrer">On {hostOf(p.source)} ↗</a> : "From a Google search"}
                {p.infoFrom && p.infoFrom !== p.source && <>{" · "}<a href={p.infoFrom} target="_blank" rel="noreferrer">contact info on {hostOf(p.infoFrom)} ↗</a></>}
              </span>
            </span>
            {contactId
              ? (
                <span className="flex items-center gap-2">
                  {patch && <button type="button" className="btn soft sm" disabled={busy} onClick={() => void addInfo(c!, patch)} data-testid={`act-team-update-${i}`}>Add their info</button>}
                  {c && !isLinked
                    ? <button type="button" className="btn acc sm" disabled={busy} onClick={() => void link(c)} data-testid={`act-team-attach-${i}`}>Link</button>
                    : <Link href={hrefFor("contact", contactId)} className="chip a" data-testid={`act-team-added-${i}`}>In contacts →</Link>}
                </span>
              )
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
