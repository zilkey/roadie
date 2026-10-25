"use client";
import { useEffect, useState, type FormEvent } from "react";
import css from "./fans.module.css";

// The public fan list page. Plain fetch against /api/public/{slug}; no app components, auth or Firebase.
interface Show { showId: string; label: string; date: string }
interface View {
  artistName: string; instagram: string | null; wording: string;
  current: (Show & { mode: "during" | "morning-after" }) | null;
  choices: Show[];
}
type Load = { s: "loading" } | { s: "missing" } | { s: "failed" } | { s: "ok"; view: View };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const instagramUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://instagram.com/${v.replace(/^@/, "")}`);

export function FanList({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  // undefined = the page's own pick (view.current); null = "Not at a show"; else a show id.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/public/${encodeURIComponent(slug)}/list`)
      .then(async (r) => {
        if (r.status === 404) return { s: "missing" } as Load;
        if (!r.ok) return { s: "failed" } as Load;
        return { s: "ok", view: (await r.json()) as View } as Load;
      })
      .catch(() => ({ s: "failed" }) as Load)
      .then((l) => { if (live) setLoad(l); });
    return () => { live = false; };
  }, [slug]);

  if (load.s === "loading") return <main className={css.page} data-testid="fans-page" aria-busy="true" />;
  if (load.s === "missing") {
    return (
      <main className={css.page} data-testid="fans-page"><div className={css.col}>
        <h1 className={css.name} data-testid="fans-not-found">Not found</h1>
        <p className={css.note}>There&apos;s no list at this address.</p>
      </div></main>
    );
  }
  if (load.s === "failed") {
    return (
      <main className={css.page} data-testid="fans-page"><div className={css.col}>
        <p className={css.error} role="alert" data-testid="fans-error">Couldn&apos;t load this page. Check your connection and reload.</p>
      </div></main>
    );
  }

  const { view } = load;
  const showId = picked === undefined ? view.current?.showId ?? null : picked;
  const show = showId ? [view.current, ...view.choices].find((s) => s?.showId === showId) ?? null : null;
  const isCurrent = !!show && show.showId === view.current?.showId;
  const when = !show ? "" : isCurrent ? (view.current!.mode === "during" ? "Tonight" : "Last night") : dayLabel(show.date);
  const pitch = !show
    ? "Show news and new music, about once a month."
    : isCurrent && view.current!.mode === "during"
      ? "You're at our show tonight. Leave your email and we'll tell you when we're back."
      : isCurrent
        ? "Thanks for coming last night. Leave your email and we'll tell you when we're back."
        : "Leave your email and we'll tell you when we're back.";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (!EMAIL.test(em)) { setError(em ? "That email doesn't look right. Check for a typo." : "Type your email to join."); return; }
    setError(""); setBusy(true);
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/signup`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: em, page: `/f/${slug}`,
          ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
          ...(show ? { showId: show.showId } : city.trim() ? { city: city.trim() } : {}),
        }),
      });
      if (res.ok) { setDone(true); return; }
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? "Something went wrong. Try again.");
    } catch { setError("Couldn't reach the server. Try again."); } finally { setBusy(false); }
  }

  if (done) {
    const name = firstName.trim();
    return (
      <main className={css.page} data-testid="fans-page"><div className={css.col}>
        <h1 className={css.name}><span className={css.eyebrow}>You&apos;re on the list</span>{view.artistName}</h1>
        <div className={css.thanks} data-testid="fans-thanks">
          <div className={css.big}>Thanks{name ? <>, <span>{name}</span></> : null}.</div>
          <p className={css.pitch}>We&apos;ll write when there&apos;s a new song or a show.</p>
          {view.instagram ? <a className={css.btn} href={instagramUrl(view.instagram)} target="_blank" rel="noopener noreferrer" data-testid="fans-instagram">Follow on Instagram</a> : null}
        </div>
      </div></main>
    );
  }

  return (
    <main className={css.page} data-testid="fans-page"><div className={css.col}>
      <h1 className={css.name}><span className={css.eyebrow}>Get on the list</span>{view.artistName}</h1>
      {picking ? (
        <div className={css.choose} role="group" aria-label="Which show">
          {view.choices.map((c) => (
            <button key={c.showId} type="button" className={css.choice} aria-pressed={showId === c.showId} data-testid="fans-choice"
              onClick={() => { setPicked(c.showId); setPicking(false); }}>
              <b>{c.label}</b><span>{dayLabel(c.date)}</span>
            </button>
          ))}
          <button type="button" className={css.choice} aria-pressed={!showId} data-testid="fans-choice" data-none="true"
            onClick={() => { setPicked(null); setPicking(false); }}>
            <b>Not at a show</b><span>Just want news</span>
          </button>
        </div>
      ) : show ? (
        <div className={css.show} data-testid="fans-show">
          <span className={css.dot} />
          <div><b>{show.label}</b><span className={css.sub}>{when}</span></div>
          {view.choices.length ? <button type="button" className={css.change} data-testid="fans-change" onClick={() => setPicking(true)}>Change</button> : null}
        </div>
      ) : view.choices.length ? (
        <button type="button" className={css.change} style={{ marginLeft: 0, justifySelf: "start" }} data-testid="fans-change" onClick={() => setPicking(true)}>At a show? Pick it</button>
      ) : null}
      <p className={css.pitch}>{pitch}</p>
      <form className={css.form} onSubmit={submit} noValidate>
        <label className={css.field}>Email
          <input type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="fans-email" />
        </label>
        <label className={css.field}>First name · optional
          <input type="text" autoComplete="given-name" placeholder="So we can say hi" value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="fans-first-name" />
        </label>
        {!show ? (
          <label className={css.field}>Your city · optional
            <input type="text" autoComplete="address-level2" placeholder="Boulder" value={city} onChange={(e) => setCity(e.target.value)} data-testid="fans-city" />
          </label>
        ) : null}
        {error ? <p className={css.error} role="alert" data-testid="fans-error">{error}</p> : null}
        <button type="submit" className={css.btn} disabled={busy} data-testid="fans-join">Join the list</button>
        <p className={css.fine}>{view.wording}</p>
      </form>
    </div></main>
  );
}
