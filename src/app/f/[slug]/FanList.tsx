"use client";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { cartNote, cartTotal, money, onColor, venmoPayUrl, type Cart } from "@/lib/merch";
import css from "./fans.module.css";

// The public fan page: the email list and the merch price list. Plain fetch against /api/public/{slug}; no app components, auth or Firebase.
interface Item { id: string; name: string; priceCents: number }
interface View {
  artistName: string; instagram: string | null; wording: string;
  current: { showId: string; label: string; date: string } | null;
  merch: { venmo: string; items: Item[] } | null;
  style: { theme: "auto" | "light" | "dark"; accent: string | null };
}
type Load = { s: "loading" } | { s: "missing" } | { s: "failed" } | { s: "ok"; view: View };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP = /^\d{5}$/;
const instagramUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://instagram.com/${v.replace(/^@/, "")}`);

/** The page's colors: data-theme picks light or dark (auto follows the phone), --brand overrides the accent. */
function look(style: View["style"] | undefined): { "data-theme"?: string; style?: CSSProperties } {
  if (!style) return {};
  const vars = style.accent ? ({ "--brand": style.accent, "--on-brand": onColor(style.accent) } as CSSProperties) : undefined;
  return { "data-theme": style.theme, ...(style.accent ? { "data-brand": "" } : {}), style: vars };
}

/** The price list with a plus/minus per item and one Venmo button that carries the total and a note. */
function Merch({ merch }: { merch: NonNullable<View["merch"]> }) {
  const [cart, setCart] = useState<Cart>({});
  const total = cartTotal(merch.items, cart);
  const note = cartNote(merch.items, cart);
  const bump = (id: string, by: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(20, (c[id] ?? 0) + by)) }));
  return (
    <section className={css.merch} aria-labelledby="merch-h" data-testid="fans-merch">
      <h2 id="merch-h" className={css.eyebrow}>Merch</h2>
      {merch.items.length ? (
        <ul className={css.items}>
          {merch.items.map((i) => {
            const n = cart[i.id] ?? 0;
            return (
              <li key={i.id} className={css.item} data-testid="fans-merch-item">
                <span className={css.itemName}>{i.name}</span>
                <span className={css.price}>{money(i.priceCents)}</span>
                <span className={css.qty}>
                  <button type="button" className={css.step} aria-label={`One less ${i.name}`} disabled={!n} onClick={() => bump(i.id, -1)} data-testid="fans-merch-minus">−</button>
                  <b aria-live="polite" data-testid="fans-merch-count">{n}</b>
                  <button type="button" className={css.step} aria-label={`One more ${i.name}`} onClick={() => bump(i.id, 1)} data-testid="fans-merch-plus">+</button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <a className={css.btn} href={venmoPayUrl(merch.venmo, total, note)} target="_blank" rel="noopener noreferrer" data-testid="fans-venmo">
        {total ? `Pay ${money(total)} with Venmo` : "Pay with Venmo"}
      </a>
      <p className={css.fine} data-testid="fans-venmo-fine">
        {total ? <>Venmo opens with {money(total)} to @{merch.venmo} and the note “{note}”.</> : <>Pay @{merch.venmo} on Venmo.</>}
      </p>
    </section>
  );
}

export function FanList({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");
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
  const show = view.current;
  const pitch = show ? "You're at our show tonight. Leave your email and we'll tell you when we're back." : "Show news and new music, about once a month.";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const em = email.trim(), z = zip.trim();
    if (!EMAIL.test(em)) { setError(em ? "That email doesn't look right. Check for a typo." : "Type your email to join."); return; }
    if (z && !ZIP.test(z)) { setError("Use a 5-digit zip code, or leave it blank."); return; }
    setError(""); setBusy(true);
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/signup`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: em, page: `/f/${slug}`, ...(name.trim() ? { name: name.trim() } : {}), ...(z ? { zip: z } : {}) }),
      });
      if (res.ok) { setDone(true); return; }
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? "Something went wrong. Try again.");
    } catch { setError("Couldn't reach the server. Try again."); } finally { setBusy(false); }
  }

  const merch = view.merch ? <Merch merch={view.merch} /> : null;
  if (done) {
    const first = name.trim().split(/\s+/)[0];
    return (
      <main className={css.page} data-testid="fans-page" {...look(view.style)}><div className={css.col}>
        <h1 className={css.name}><span className={css.eyebrow}>You&apos;re on the list</span>{view.artistName}</h1>
        <div className={css.thanks} data-testid="fans-thanks">
          <div className={css.big}>Thanks{first ? <>, <span>{first}</span></> : null}.</div>
          <p className={css.pitch}>We&apos;ll write when there&apos;s a new song or a show.</p>
          {view.instagram ? <a className={`${css.btn} ${css.ghost}`} href={instagramUrl(view.instagram)} target="_blank" rel="noopener noreferrer" data-testid="fans-instagram">Follow on Instagram</a> : null}
        </div>
        {merch}
      </div></main>
    );
  }

  return (
    <main className={css.page} data-testid="fans-page" {...look(view.style)}><div className={css.col}>
      <h1 className={css.name} data-testid="fans-name"><span className={css.eyebrow}>Get on the list</span>{view.artistName}</h1>
      {show ? (
        <div className={css.show} data-testid="fans-show">
          <span className={css.dot} />
          <div><b>{show.label}</b><span className={css.sub}>Tonight</span></div>
        </div>
      ) : null}
      <p className={css.pitch}>{pitch}</p>
      <form className={css.form} onSubmit={submit} noValidate>
        <label className={css.field}>Email
          <input type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="fans-email" />
        </label>
        <label className={css.field}>Name · optional
          <input type="text" autoComplete="name" placeholder="So we can say hi" value={name} onChange={(e) => setName(e.target.value)} data-testid="fans-first-name" />
        </label>
        <label className={css.field}>Zip code · optional
          <input type="text" autoComplete="postal-code" inputMode="numeric" maxLength={5} placeholder="80302" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} data-testid="fans-zip" />
        </label>
        {error ? <p className={css.error} role="alert" data-testid="fans-error">{error}</p> : null}
        <button type="submit" className={css.btn} disabled={busy} data-testid="fans-join">Join the list</button>
        <p className={css.fine}>{view.wording}</p>
      </form>
      {merch}
    </div></main>
  );
}
