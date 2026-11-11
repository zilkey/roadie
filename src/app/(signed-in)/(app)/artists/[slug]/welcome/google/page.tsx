"use client";
import { useEffect, useState } from "react";
import NextLink from "next/link";
import { AdminOnly } from "@/components/Guard";
import { FEATURES, NotConfiguredCard, type Feature, type Status } from "@/components/google/shared";
import { ErrorBox, useCommand } from "@/components/ui";
import { useArtist } from "@/lib/artist";
import { runCommand } from "@/lib/commands";
import { artistPath } from "@/lib/routes";

export default function WelcomeGooglePage() { return <AdminOnly><Connect /></AdminOnly>; }

/** Sign-up flow: pick what Roadie may use, then on to Google's consent page. It comes back to /welcome/google/setup. */
function Connect() {
  const artist = useArtist();
  const [status, setStatus] = useState<Status | null>(null);
  const [picked, setPicked] = useState<Feature[]>(["calendar", "gmail", "drive"]);
  const { call, error, busy, setError } = useCommand();
  const ready = artistPath(artist.slug, "/welcome");

  useEffect(() => { runCommand<Status>("google.status", {}).then(setStatus, (e: Error) => setError(e.message)); }, [setError]);

  async function connect() {
    const r = await call<{ url: string }>("google.connectUrl", { features: picked, returnTo: "/welcome/google/setup" });
    if (r) window.location.assign(r.url);
  }

  return (
    <div className="mx-auto grid max-w-xl gap-5" data-testid="welcome-google">
      <div className="grid gap-1 text-center">
        <h1 className="page-title" data-testid="page-title">Connect Google</h1>
        <p className="s">Roadie only gets the parts you tick. Nothing is written to Google when you connect.</p>
      </div>
      {!status ? <p className="s" data-testid="google-loading">Loading…</p> : !status.configured ? <NotConfiguredCard /> : (
        <section className="card" aria-labelledby="welcome-google-title">
          <div className="card-head"><h2 id="welcome-google-title">Connect Google for</h2></div>
          <div className="grid gap-0">
            {FEATURES.map(([f, name, what]) => (
              <label key={f} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start">
                <input type="checkbox" className="m-0 h-[18px] w-[18px]" checked={picked.includes(f)} data-testid={`google-pick-${f}`}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))} />
                <span><b>{name}</b> <span className="s">· {what}</span></span>
              </label>
            ))}
          </div>
          <ErrorBox error={error} />
          <div className="card-foot"><div className="end">
            <button type="button" className="btn acc" disabled={busy || !picked.length} onClick={() => void connect()} data-testid="google-connect">Continue with Google</button>
          </div></div>
        </section>
      )}
      {status && !status.configured && <ErrorBox error={error} />}
      <NextLink href={ready} className="btn text" data-testid="google-skip">Skip for now</NextLink>
    </div>
  );
}
