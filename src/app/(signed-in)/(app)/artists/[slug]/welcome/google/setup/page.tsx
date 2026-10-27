"use client";
import { useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { AdminOnly } from "@/components/Guard";
import { FolderCard } from "@/components/google/FolderCard";
import { list, type Calendar, type Status } from "@/components/google/shared";
import { ErrorBox, useCommand } from "@/components/ui";
import { useArtist } from "@/lib/artist";
import { runCommand } from "@/lib/commands";
import { artistPath } from "@/lib/routes";

export default function WelcomeGoogleSetupPage() { return <AdminOnly><Setup /></AdminOnly>; }

/** Where Google's consent page lands in the sign-up flow: finish the connect, then choose the band folder and calendar (read only). */
function Setup() {
  const artist = useArtist();
  const [status, setStatus] = useState<Status | null>(null);
  const [missing, setMissing] = useState<Status["missing"]>([]);
  const { error, setError } = useCommand();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const code = q.get("code"), state = q.get("state"), denied = q.get("error");
    if (code || denied) window.history.replaceState(null, "", window.location.pathname);
    if (denied) setError(denied === "access_denied" ? "Google wasn't connected: access was declined." : `Google: ${denied}`);
    const load = code && state ? runCommand<Status>("google.finishConnect", { code, state }) : runCommand<Status>("google.status", {});
    load.then((s) => { setMissing(s.missing ?? []); setStatus(s); }, (e: Error) => { setError(e.message); runCommand<Status>("google.status", {}).then(setStatus, () => undefined); });
  }, [setError]);

  const me = status?.me;
  return (
    <div className="mx-auto grid max-w-xl gap-5" data-testid="welcome-google-setup">
      <div className="grid gap-1 text-center">
        <h1 className="page-title" data-testid="page-title">Set up Google</h1>
      </div>
      {!status ? <p className="s" data-testid="google-loading">Loading…</p> : (
        <>
          {me?.features.length ? (
            <p className="m-0 font-semibold" style={{ color: "var(--success-text)" }} role="status" data-testid="google-connected">Connected as {me.googleEmail} for {list(me.features)}.</p>
          ) : <p className="s m-0" data-testid="google-not-connected">Google isn&apos;t connected yet. You can connect it in Settings.</p>}
          {!!missing?.length && <p className="s m-0" data-testid="google-missing">Google didn&apos;t grant {list(missing)}. Connect again from Settings to allow it.</p>}
          {me && (me.features.includes("calendar") || me.features.includes("drive")) && status.band?.isMe && (
            <p className="s m-0" data-testid="google-band-account">
              This account is now the band&apos;s {[me.features.includes("drive") && "Drive", me.features.includes("calendar") && "Calendar"].filter(Boolean).join(" and ")} account.
            </p>
          )}
          <ErrorBox error={error} />
          {status.driveReady && <FolderCard which="band" status={status} onChange={setStatus} />}
          {status.calendarReady && <CalendarPick status={status} onChange={setStatus} />}
        </>
      )}
      <NextLink href={artistPath(artist.slug, "/welcome")} className="btn text" data-testid="google-finish-later">Finish later in Settings</NextLink>
    </div>
  );
}

/** Band calendar: radio list of the calendars this account can add events to, then Save. Reads only. */
function CalendarPick({ status, onChange }: { status: Status; onChange(s: Status): void }) {
  const { call, error, busy } = useCommand();
  const [cals, setCals] = useState<Calendar[] | null>(null);
  const [pick, setPick] = useState<string>(status.calendar?.id ?? "");
  const [saved, setSaved] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void call<{ calendars: Calendar[] }>("google.calendars", {}).then((r) => { if (r) setCals(r.calendars); });
  }, [call]);

  async function save() {
    const s = await call<Status>("google.setCalendar", { calendarId: pick });
    if (s) { onChange(s); setSaved(true); }
  }
  return (
    <section className="card" data-testid="google-calendar" aria-labelledby="welcome-calendar-title">
      <div className="card-head"><h2 id="welcome-calendar-title">Band calendar</h2></div>
      <p className="s m-0">Where shows and rehearsals go. Saving never sends anything.</p>
      {cals && cals.length === 0 && <span className="s" data-testid="calendar-empty">No calendars in your Google account.</span>}
      <div className="grid gap-0" role="radiogroup" aria-labelledby="welcome-calendar-title" data-testid="calendar-list">
        {(cals ?? []).map((c) => (
          <label key={c.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start" data-testid={`calendar-hit-${c.name}`}>
            <input type="radio" name="band-calendar" className="m-0 h-[18px] w-[18px]" checked={pick === c.id} disabled={!c.canWrite}
              onChange={() => { setPick(c.id); setSaved(false); }} data-testid="calendar-choose" />
            <span><b>{c.name}</b> <span className="s">· {c.primary ? "Your own calendar" : c.canWrite ? "You can add events" : "View only"}</span></span>
          </label>
        ))}
      </div>
      {saved && <p className="s m-0" role="status" data-testid="calendar-note">Band calendar saved.</p>}
      <ErrorBox error={error} />
      <div className="card-foot"><div className="end">
        <button type="button" className="btn acc" disabled={busy || !pick || pick === status.calendar?.id && saved} onClick={() => void save()} data-testid="calendar-save">Save</button>
      </div></div>
    </section>
  );
}
