"use client";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { cartNote, cartTotal, money, onColor, venmoPayUrl, type Cart } from "@/lib/merch";
import css from "./fans.module.css";

// The public fan page, top to bottom: the email list, tonight's shows (Ticket or Suggested Donation), merch, Leave a tip, the page's links, then the artist's socials. Plain fetch against /api/public/{slug}; no app components, auth or Firebase.
interface Item { id: string; name: string; priceCents: number }
interface ShowLine { id: string; name: string; amountCents: number; button: "ticket" | "donation" }
interface View {
  artistName: string; logo: string | null; wording: string;
  current: { showId: string; label: string; date: string } | null;
  merch: { venmo: string; items: Item[] } | null;
  shows: { venmo: string; items: ShowLine[] } | null;
  tip: { venmo: string } | null;
  links: { id: string; name: string; url: string }[];
  socials: { key: string; label: string; url: string }[];
  style: { theme: "auto" | "light" | "dark"; accent: string | null };
}
type Load = { s: "loading" } | { s: "missing" } | { s: "failed" } | { s: "ok"; view: View };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP = /^\d{5}$/;

/** The page's colors: data-theme picks light or dark (auto follows the phone), --brand overrides the accent. */
function look(style: View["style"] | undefined): { "data-theme"?: string; style?: CSSProperties } {
  if (!style) return {};
  const vars = style.accent ? ({ "--brand": style.accent, "--on-brand": onColor(style.accent) } as CSSProperties) : undefined;
  return { "data-theme": style.theme, ...(style.accent ? { "data-brand": "" } : {}), style: vars };
}

/** The heading: the logo when there is one (its alt text is the name), else the name in big letters. */
function Name({ view, eyebrow }: { view: View; eyebrow: string }) {
  return (
    <h1 className={css.name} data-testid="fans-name">
      <span className={css.eyebrow}>{eyebrow}</span>
      {view.logo ? <img className={css.logo} src={view.logo} alt={view.artistName} data-testid="fans-logo" /> : view.artistName}
    </h1>
  );
}

/** An envelope, for Join the list. */
const MailIcon = () => (
  <svg className={css.icon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
  </svg>
);
/** Venmo's V in a rounded square, for every button that opens Venmo. */
const VenmoIcon = () => (
  <svg className={css.icon} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" data-testid="venmo-icon">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
    <path d="M16.6 5.6c.5.8.7 1.6.7 2.6 0 3.2-2.7 7.3-4.9 10.2H7.4L5.4 6.3l4.4-.4 1.1 8.6c1-1.6 2.2-4.2 2.2-6 0-1-.2-1.6-.4-2.2l3.9-.7Z" fill="var(--accent)" />
  </svg>
);

/** The Venmo button's words and note for `n` of a show's line: "Buy 2 Tickets · $40" / "Suggested Donation · $20". */
function showButton(l: ShowLine, n: number): { label: string; note: string } {
  const total = money(l.amountCents * n);
  if (l.button === "donation") return { label: `Suggested Donation · ${total}`, note: n > 1 ? `${l.name} (${n} people)` : l.name };
  const word = n === 1 ? "Ticket" : "Tickets";
  return { label: `Buy ${n} ${word} · ${total}`, note: `${n} ${word.toLowerCase()}, ${l.name}` };
}

/** One show's line: the name and price each, + and − like merch, and a Venmo button with the total and the show as the note. */
function ShowPay({ l, venmo }: { l: ShowLine; venmo: string }) {
  const [n, setN] = useState(1);
  const b = showButton(l, n);
  const what = l.button === "donation" ? "person" : "ticket";
  return (
    <section className={css.merch} aria-label={l.name} data-testid="fans-show-line" data-show-id={l.id}>
      <h2 className={css.eyebrow}>{l.button === "donation" ? "Suggested donation" : "Tickets"}</h2>
      <div className={css.item}>
        <span className={css.itemName} data-testid="fans-show-name">{l.name}</span>
        <span className={css.price}>{money(l.amountCents)}</span>
        <span className={css.qty}>
          <button type="button" className={css.step} aria-label={`One less ${what}`} disabled={n <= 1} onClick={() => setN((x) => Math.max(1, x - 1))} data-testid="fans-show-minus">−</button>
          <b aria-live="polite" data-testid="fans-show-count">{n}</b>
          <button type="button" className={css.step} aria-label={`One more ${what}`} disabled={n >= 20} onClick={() => setN((x) => Math.min(20, x + 1))} data-testid="fans-show-plus">+</button>
        </span>
      </div>
      <a className={css.btn} href={venmoPayUrl(venmo, l.amountCents * n, b.note)} target="_blank" rel="noopener noreferrer" data-testid="fans-show-pay"><VenmoIcon />{b.label}</a>
      <p className={css.fine}>Pays @{venmo} on Venmo{l.button === "donation" ? ". You can change the amount there." : "."}</p>
    </section>
  );
}

/** "Leave a tip": Venmo opens with "Tip" as the note and the fan types the amount. */
function Tip({ venmo }: { venmo: string }) {
  return (
    <section className={css.merch} aria-labelledby="tip-h" data-testid="fans-tip">
      <h2 id="tip-h" className={css.eyebrow}>Tip</h2>
      <a className={css.btn} href={venmoPayUrl(venmo, 0, "Tip")} target="_blank" rel="noopener noreferrer" data-testid="fans-tip-pay"><VenmoIcon />Leave a tip</a>
      <p className={css.fine}>Pays @{venmo} on Venmo. You pick the amount there.</p>
    </section>
  );
}

/** The page's own links, as buttons. */
function Links({ links }: { links: View["links"] }) {
  return (
    <section className={css.merch} aria-labelledby="links-h" data-testid="fans-links">
      <h2 id="links-h" className={css.eyebrow}>Links</h2>
      {links.map((l) => <a key={l.id} className={`${css.btn} ${css.ghost}`} href={l.url} target="_blank" rel="noopener noreferrer" data-testid="fans-link">{l.name}</a>)}
    </section>
  );
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
        <VenmoIcon />{total ? `Pay ${money(total)} with Venmo` : "Pay with Venmo"}
      </a>
      <p className={css.fine} data-testid="fans-venmo-fine">
        {total ? <>Venmo opens with {money(total)} to @{merch.venmo} and the note “{note}”.</> : <>Pay @{merch.venmo} on Venmo.</>}
      </p>
    </section>
  );
}

export function FanList({ slug, showId }: { slug: string; showId?: string }) {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/public/${encodeURIComponent(slug)}/list${showId ? `?showId=${encodeURIComponent(showId)}` : ""}`)
      .then(async (r) => {
        if (r.status === 404) return { s: "missing" } as Load;
        if (!r.ok) return { s: "failed" } as Load;
        return { s: "ok", view: (await r.json()) as View } as Load;
      })
      .catch(() => ({ s: "failed" }) as Load)
      .then((l) => { if (live) setLoad(l); });
    return () => { live = false; };
  }, [slug, showId]);

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

  const rest = (
    <>
      {view.shows?.items.map((l) => <ShowPay key={l.id} l={l} venmo={view.shows!.venmo} />)}
      {view.merch ? <Merch merch={view.merch} /> : null}
      {view.tip ? <Tip venmo={view.tip.venmo} /> : null}
      {view.links.length ? <Links links={view.links} /> : null}
      {view.socials.length ? (
        <footer className={css.socials} data-testid="fans-socials">
          {view.socials.map((x) => <a key={x.key} href={x.url} target="_blank" rel="noopener noreferrer" data-testid={`fans-social-${x.key}`}>{x.label}</a>)}
        </footer>
      ) : null}
    </>
  );
  if (done) {
    const first = name.trim().split(/\s+/)[0];
    return (
      <main className={css.page} data-testid="fans-page" {...look(view.style)}><div className={css.col}>
        <Name view={view} eyebrow="You're on the list" />
        <div className={css.thanks} data-testid="fans-thanks">
          <div className={css.big}>Thanks{first ? <>, <span>{first}</span></> : null}.</div>
          <p className={css.pitch}>We&apos;ll write when there&apos;s a new song or a show.</p>
        </div>
        {rest}
      </div></main>
    );
  }

  return (
    <main className={css.page} data-testid="fans-page" {...look(view.style)}><div className={css.col}>
      <Name view={view} eyebrow="Get on the list" />
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
        <button type="submit" className={css.btn} disabled={busy} data-testid="fans-join"><MailIcon />Join the list</button>
        <p className={css.fine}>{view.wording}</p>
      </form>
      {rest}
    </div></main>
  );
}
