"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { CommandError } from "@/lib/commands";
import { signUpBand } from "@/lib/sign-up";
import { artistPath } from "@/lib/routes";
import { ErrorBox } from "@/components/ui";
import { useNoBand } from "@/components/welcome/useNoBand";
import { artistSlug, parseInstruments, slugForArtist } from "@/schema";

/**
 * Name your band: one required answer (the name), one optional (what you play). Nothing exists until Start a band is
 * pressed; Back throws the form away (nothing is saved as a draft).
 */
export function StartBandForm({ termsUrl }: { termsUrl: string }) {
  const { refresh } = useAuth();
  const router = useRouter();
  const staying = useRef(false);
  const me = useNoBand(staying);
  const [name, setName] = useState("");
  const [play, setPlay] = useState("");
  const [custom, setCustom] = useState<string | null>(null); // the slug once they pick their own
  const [changing, setChanging] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return <div className="grid min-h-dvh place-items-center s" data-testid="auth-loading">Loading…</div>;

  const derived = slugForArtist(name.trim() || "your band");
  const slug = custom ?? derived;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Give your band a name";
    if (custom !== null) {
      const ok = artistSlug.safeParse(custom);
      if (!ok.success) next.slug = ok.error.issues[0].message;
    }
    setErrs(next);
    if (Object.keys(next).length) { if (next.slug) setChanging(true); document.getElementById(next.name ? "band-name" : "band-slug")?.focus(); return; }
    setBusy(true);
    try {
      const instruments = parseInstruments(play);
      const r = await signUpBand({ name: name.trim(), ...(custom !== null ? { slug: custom } : {}), ...(instruments.length ? { instruments } : {}) });
      staying.current = true;
      await refresh();
      router.replace(artistPath(r.slug, "/welcome"));
    } catch (err) {
      staying.current = false;
      const ce = err as CommandError;
      const fields = Object.fromEntries((ce.issues ?? []).map((i) => [i.path, i.message]));
      if (ce.code === "slug_taken") { setChanging(true); setErrs({ slug: "Already taken" }); }
      else if (Object.keys(fields).length) { setErrs(fields); if (fields.slug) setChanging(true); }
      else setError(ce.message ?? "Something went wrong");
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 py-10">
      <form onSubmit={submit} noValidate className="grid gap-4" data-testid="start-band-form">
        <h1 className="page-title">Name your band</h1>
        <ErrorBox error={error} />
        <div className="grid gap-1">
          <label className="lbl" htmlFor="band-name">Band name</label>
          <input id="band-name" className="input" data-testid="band-name" autoFocus autoComplete="off" value={name} placeholder="The Night Owls"
            aria-invalid={!!errs.name} onChange={(e) => { setName(e.target.value); setErrs((x) => ({ ...x, name: "" })); }} />
          {errs.name && <p className="err" role="alert" data-testid="band-name-error">{errs.name}</p>}
          <p className="s" data-testid="band-url">
            app.myroadie.online/artists/<b data-testid="band-slug-preview">{slug}</b>{" "}
            {!changing && <button type="button" className="underline" data-testid="slug-change" onClick={() => { setChanging(true); setCustom(slug); }}>Change</button>}
          </p>
          {changing && (
            <div className="grid gap-1">
              <label className="lbl" htmlFor="band-slug">Web address</label>
              <input id="band-slug" className="input" data-testid="band-slug" autoComplete="off" value={custom ?? slug} aria-invalid={!!errs.slug}
                onChange={(e) => { setCustom(e.target.value.toLowerCase()); setErrs((x) => ({ ...x, slug: "" })); }} />
              {errs.slug && <p className="err" role="alert" data-testid="band-slug-error">{errs.slug}</p>}
            </div>
          )}
        </div>
        <div className="grid gap-1">
          <label className="lbl" htmlFor="band-play">What do you play? <span className="font-normal">(optional)</span></label>
          <input id="band-play" className="input" data-testid="band-play" autoComplete="off" value={play} placeholder="guitar, vocals" onChange={(e) => setPlay(e.target.value)} />
          <p className="s">Separate with commas. You&apos;ll be added to the band as a member.</p>
        </div>
        <button className="btn acc" data-testid="create-band" disabled={busy}>{busy ? "Starting…" : "Start a band"}</button>
        <Link href="/no-band" className="btn ghost" data-testid="back">Back</Link>
        <p className="s">By creating a band you agree to the <a href={termsUrl} data-testid="terms-link">Terms</a>.</p>
      </form>
    </main>
  );
}
