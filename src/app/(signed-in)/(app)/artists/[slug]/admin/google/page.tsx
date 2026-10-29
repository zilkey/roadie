"use client";
import { useEffect, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import { FolderCard } from "@/components/google/FolderCard";
import { ShortcutCard } from "@/components/google/ShortcutCard";
import { FEATURES, list, NotConfiguredCard, type Calendar, type Check, type Feature, type Status } from "@/components/google/shared";

export default function GooglePage() { return <AdminOnly><GoogleSettings /></AdminOnly>; }

/**
 * Settings > Google. Each admin connects their own Google account for the features they tick; Google's consent page
 * comes back through /api/google/callback to this page with ?code&state, which finishes the connection here.
 */
function GoogleSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const { call, error, busy, setError } = useCommand();
  const [picked, setPicked] = useState<Feature[]>(["calendar", "gmail"]);
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const code = q.get("code"), state = q.get("state"), denied = q.get("error");
    if (code || denied) window.history.replaceState(null, "", window.location.pathname);
    if (denied) setError(denied === "access_denied" ? "Google wasn't connected: access was declined." : `Google: ${denied}`);
    const load = code && state
      ? runCommand<Status>("google.finishConnect", { code, state }).then((s) => {
        if (s.missing?.length) setNote(`Google didn't grant ${list(s.missing)}. Tick it and connect again to allow it.`);
        else setNote("Connected.");
        return s;
      })
      : runCommand<Status>("google.status", {});
    load.then(setStatus, (e: Error) => { setError(e.message); runCommand<Status>("google.status", {}).then(setStatus, () => undefined); });
  }, [setError]);

  useEffect(() => { if (status?.me) setPicked(status.me.features.length ? status.me.features : ["calendar", "gmail"]); }, [status?.me]);

  async function connect() {
    const r = await call<{ url: string }>("google.connectUrl", { features: picked });
    if (r) window.location.assign(r.url);
  }
  async function act(name: "google.disconnect" | "google.useForBand") {
    setNote(null);
    const s = await call<Status>(name, {});
    if (s) setStatus(s);
  }

  const me = status?.me;
  const adds = picked.some((f) => !me?.features.includes(f));
  return (
    <div className="grid gap-5">
      <PageTitle title="Google" sub="Send pitches from your own Gmail, put shows and rehearsals on the band calendar, and find song files in Drive." />
      {!status ? <p className="s" data-testid="google-loading">Loading…</p> : !status.configured ? (
        <NotConfiguredCard />
      ) : (
        <>
          {!!status.fakes?.length && (
            <p className="err m-0" role="status" data-testid="google-fakes">
              {list(status.fakes)} still {status.fakes.length > 1 ? "go" : "goes"} to the local fake: blank {status.fakes.map((f) => `${f.toUpperCase()}_BASE_URL`).join(", ")} (e.g. in .env.development.local) to use Google.
            </p>
          )}
          <section className="card" data-testid="google-me" aria-labelledby="google-me-title">
            <div className="card-head"><h2 id="google-me-title">Your Google account</h2>{me && <span className="tag" data-testid="google-me-email">{me.googleEmail}</span>}</div>
            <p className="m-0" data-testid="google-me-status">
              {me?.features.length ? <>Connected for {list(me.features)}.</> : "Not connected. Roadie only gets the parts you tick, and you can disconnect any time."}
            </p>
            <div className="grid gap-0">
              <span className="lbl">Connect Google for</span>
              {FEATURES.map(([f, name, what]) => (
                <label key={f} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start">
                  <input type="checkbox" className="m-0 h-[18px] w-[18px]" checked={picked.includes(f)} data-testid={`google-pick-${f}`}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))} />
                  <span><b>{name}</b> <span className="s">· {what}</span></span>
                </label>
              ))}
            </div>
            {note && <p className="s m-0" role="status" data-testid="google-note">{note}</p>}
            <ErrorBox error={error} />
            <div className="card-foot"><div className="end">
              {me && <button type="button" className="btn text" disabled={busy} onClick={() => act("google.disconnect")} data-testid="google-disconnect">Disconnect</button>}
              <button type="button" className="btn acc" disabled={busy || !picked.length} onClick={connect} data-testid="google-connect">
                {!me ? "Connect Google" : adds ? "Add to connection" : "Reconnect"}
              </button>
            </div></div>
          </section>

          <section className="card" data-testid="google-band" aria-labelledby="google-band-title">
            <div className="card-head"><h2 id="google-band-title">Band Drive</h2></div>
            <p className="m-0" data-testid="google-band-status">
              {status.band
                ? <>Drive searches and sharing checks look in <b>{status.band.isMe ? "your" : `${status.band.name}’s`}</b> Drive ({status.band.email}).
                  {!status.band.features.includes("drive") && <span> Drive isn&apos;t connected on it yet.</span>}</>
                : "No one's Google account is set for the band's Drive yet. The first admin to connect Calendar or Drive becomes it."}
            </p>
            {me && !status.band?.isMe && me.features.includes("drive") && (
              <div className="card-foot"><div className="end">
                <button type="button" className="btn" disabled={busy} onClick={() => act("google.useForBand")} data-testid="google-use-for-band">Use my account</button>
              </div></div>
            )}
          </section>
        </>
      )}
      {status && <CalendarCard status={status} onChange={setStatus} />}
      {status && <FolderCard which="band" status={status} onChange={setStatus} />}
      {status && <FolderCard which="charts" status={status} onChange={setStatus} />}
      {status && <FolderCard which="demos" status={status} onChange={setStatus} />}
      {status && <FolderCard which="songwriting" status={status} onChange={setStatus} />}
      {status && <FolderCard which="rehearsal" status={status} onChange={setStatus} />}
      {status && <FolderCard which="shows" status={status} onChange={setStatus} />}
      {status && <FolderCard which="releases" status={status} onChange={setStatus} />}
      {status && <ShortcutCard />}
    </div>
  );
}

/**
 * The band calendar: the shared Google Calendar show and rehearsal events go on when an admin sends them. Chosen from
 * the caller's own calendar list (only ones they can add events to). Each admin's sends use their own Google account, so
 * "Check my access" tells them whether theirs can write to it.
 */
function CalendarCard({ status, onChange }: { status: Status; onChange(s: Status): void }) {
  const { call, error, busy, setError } = useCommand();
  const [found, setFound] = useState<Calendar[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const cal = status.calendar;

  async function open() {
    setNote(null); setCheck(null);
    const r = await call<{ calendars: Calendar[] }>("google.calendars", {});
    if (r) setFound(r.calendars);
  }
  async function choose(calendarId: string) {
    const s = await call<Status>("google.setCalendar", { calendarId });
    if (!s) return;
    onChange(s); setFound(null);
    setNote("Band calendar saved. Shows and rehearsals go on it when someone presses Add to calendar on them.");
  }
  async function checkAccess() {
    setNote(null);
    const r = await call<Check>("google.checkCalendar", {});
    if (r) setCheck(r);
  }

  return (
    <section className={`card${found ? " editing" : ""}`} data-testid="google-calendar" aria-labelledby="google-calendar-title">
      <div className="card-head">
        <h2 id="google-calendar-title">Band calendar</h2>
        {status.calendarReady && !found && <button type="button" className="card-edit" disabled={busy} onClick={() => void open()} data-testid="calendar-change">{cal ? "Change" : "Choose"}</button>}
      </div>
      <p className="m-0" data-testid="calendar-status">
        {cal
          ? <><b data-testid="calendar-name">{cal.name}</b>. Shows and rehearsals go here when an admin presses Add to calendar on them, sent from that admin&apos;s own Google account. Saving never sends anything.</>
          : "Not chosen yet. Shows and rehearsals can't go on a calendar until you choose the band's shared Google Calendar."}
      </p>
      {!status.calendarReady && <p className="s m-0" data-testid="calendar-needs-connect">Connect Calendar on your Google account (above) to {cal ? "change it or check your access" : "choose it"}.</p>}
      {note && <p className="s m-0" role="status" data-testid="calendar-note">{note}</p>}
      {check && (
        <p className="m-0" role="status" data-testid="calendar-check">
          {check.canWrite ? <>✓ Your Google account can add events to {cal?.name}.</>
            : check.reason === "not_connected" ? "Your Google Calendar isn't connected. Connect it above."
            : check.reason === "read_only" ? <>Your Google account can only see {cal?.name}. Ask its owner to give you &ldquo;Make changes to events&rdquo;; until then your calendar sends will fail.</>
            : <>Your Google account doesn&apos;t have {cal?.name}. Ask its owner to share it with you (&ldquo;Make changes to events&rdquo;); until then your calendar sends will fail.</>}
        </p>
      )}
      {found && (
        <div className="grid gap-2" data-testid="calendar-list">
          <span className="lbl">Your calendars</span>
          {found.length === 0 && <span className="s" data-testid="calendar-empty">No calendars in your Google account.</span>}
          {found.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-line p-2" data-testid={`calendar-hit-${c.name}`}>
              <span className="grid min-w-0 flex-1"><b className="truncate text-sm">{c.name}</b><span className="s">{c.primary ? "Your own calendar" : c.canWrite ? "You can add events" : "View only"}</span></span>
              <button type="button" className="btn acc sm" disabled={busy || !c.canWrite || c.id === cal?.id} onClick={() => void choose(c.id)} data-testid="calendar-choose">
                {c.id === cal?.id ? "Current" : "Choose"}
              </button>
            </div>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
      {(found || cal) && (
        <div className="card-foot"><div className="end">
          {found
            ? <button type="button" className="btn text" onClick={() => { setFound(null); setError(null); }} data-testid="calendar-cancel">Cancel</button>
            : <button type="button" className="btn ghost" disabled={busy} onClick={() => void checkAccess()} data-testid="calendar-check-access">Check my access</button>}
        </div></div>
      )}
    </section>
  );
}
