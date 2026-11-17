"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useArtist, useArtistRouter, useZone } from "@/lib/artist";
import { fmtDate, todayStr } from "@/lib/booking";
import { confetti } from "@/components/Celebrate";
import { MONTHS, bucks, defaultReviewYear, hours, milesLine, num, stageLine, versus, type PreviousReview, type Ranked, type YearReview as Review } from "@/lib/yearReview";
import { useReviewData } from "./useReviewData";
import s from "./review.module.css";

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
const RELEASE_KIND: Record<string, string> = { album: "album", ep: "EP", single: "single" };

/** Counts up to `n` when the slide comes on. With reduced motion it is just the number. */
function Count({ n, format = num }: { n: number; format?: (n: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(n); return; }
    let raf = 0;
    const start = performance.now(), ms = 1100;
    const frame = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(n * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  return <span aria-label={format(n)}>{format(v)}</span>;
}

function RankList({ rows, unit }: { rows: Ranked[]; unit?: (n: number) => string }) {
  return (
    <ol className={s.rank}>
      {rows.map((r, i) => (
        <li key={r.name}><span className={s.rn}>{i + 1}</span><span className={s.rname}>{r.name}</span><span className={s.rc}>{unit ? unit(r.count) : `×${r.count}`}</span></li>
      ))}
    </ol>
  );
}

interface SlideDef { key: string; palette: string; body: React.ReactNode }

/** One line of the head-to-head slide: this year's bar over the year before's, each as wide as its share of the bigger one. */
function Duel({ label, now, before, fmt = num }: { label: string; now: number; before: number; fmt?: (n: number) => string }) {
  const max = Math.max(now, before, 1);
  return (
    <div className={s.duel} data-testid="review-duel">
      <span className={s.duelLabel}>{label}</span>
      <span className={s.duelRow}><i className={s.duelNow} style={{ width: `${Math.max(2, (now / max) * 100)}%` }} /><b>{fmt(now)}</b></span>
      <span className={s.duelRow}><i style={{ width: `${Math.max(2, (before / max) * 100)}%` }} /><b>{fmt(before)}</b></span>
    </div>
  );
}

/** The slides for one year, in order. A slide with nothing to say is left out. With a year before to compare with, the big numbers say how they moved. */
function slidesFor(r: Review, band: string, prev: PreviousReview | null): SlideDef[] {
  const out: SlideDef[] = [];
  const p = prev?.review;
  const than = prev ? (prev.samePoint ? `this point in ${prev.year}` : prev.year) : "";
  /** "▲ Up 5 (+28%) from this point in 2025": nothing when there is no year before. */
  const vs = (now: number, before: number | undefined, fmt?: (n: number) => string) => {
    if (!prev || before === undefined) return null;
    const v = versus(now, before, fmt);
    return <p className={s.vs} data-dir={v.dir} data-testid="review-vs"><i aria-hidden>{v.dir === "up" ? "▲" : v.dir === "down" ? "▼" : "●"}</i>{v.dir === "same" ? `Same as ${than}` : `${v.text} from ${than}`}</p>;
  };
  const add = (key: string, palette: string, body: React.ReactNode) => out.push({ key, palette, body });
  const big = (text: string) => `${s.big}${text.length > 5 ? ` ${s.long}` : ""}`;

  add("intro", s.violet, <>
    <span className={s.tag}>{r.soFar ? "The year so far" : "Year in Review"}</span>
    <h1 className={s.title}>{band}</h1>
    <p className={s.big}>{r.year}</p>
    <p className={s.line}>The shows, the songs, the miles and the money.</p>
    <p className={s.foot}>Tap to start</p>
  </>);

  if (r.shows.count) {
    const m = r.shows.busiestMonth!;
    const max = Math.max(...r.shows.byMonth);
    add("shows", s.pink, <>
      <p className={s.kicker}>You played</p>
      <p className={s.big}><Count n={r.shows.count} /></p>
      <p className={s.unit}>{plural(r.shows.count, "show")}</p>
      {vs(r.shows.count, p?.shows.count)}
      <p className={s.line}>
        {r.shows.cities > 0 && <>in <b>{r.shows.cities}</b> {plural(r.shows.cities, "city", "cities")}</>}
        {r.shows.cities > 0 && r.shows.venues > 0 && " "}
        {r.shows.venues > 0 && <>at <b>{r.shows.venues}</b> {plural(r.shows.venues, "venue")}</>}
      </p>
      <div className={s.bars} aria-hidden>
        {r.shows.byMonth.map((n, i) => (
          <div key={i} className={`${s.bar}${i === m.month ? ` ${s.peak}` : ""}`}><span className={s.track}><i style={{ height: `${(n / max) * 100}%` }} /></span>{MONTHS[i][0]}</div>
        ))}
      </div>
      <p className={s.foot}>
        {MONTHS[m.month]} was the busiest: {m.count} {plural(m.count, "show")}.
        {r.shows.ahead > 0 && ` ${r.shows.ahead} more on the books before the year is out.`}
      </p>
    </>);

    if (r.shows.topVenues.length > 1 || r.shows.topCities.length > 1) {
      const venues = r.shows.topVenues.length > 1;
      add("places", s.aqua, <>
        <p className={s.kicker}>{venues ? "Your home stages" : "Your towns"}</p>
        <RankList rows={venues ? r.shows.topVenues : r.shows.topCities} unit={(n) => `${n} ${plural(n, "show")}`} />
        {r.shows.first && <p className={s.foot}>
          First show of the year: {r.shows.first.name}, {fmtDate(r.shows.first.date)}.
          {r.shows.last && ` Latest: ${r.shows.last.name}, ${fmtDate(r.shows.last.date)}.`}
        </p>}
        {r.shows.onTour > 0 && <p className={s.foot}>{r.shows.onTour} of them {r.shows.onTour === 1 ? "was" : "were"} on tour.</p>}
      </>);
    }
  }

  if (r.songs.played) {
    add("songs", s.lime, <>
      <p className={s.kicker}>On stage, you played</p>
      <p className={big(num(r.songs.played))}><Count n={r.songs.played} /></p>
      <p className={s.unit}>{plural(r.songs.played, "song")}</p>
      {p && p.songs.played > 0 && vs(r.songs.played, p.songs.played)}
      <p className={s.line}><b>{num(r.songs.unique)}</b> different {plural(r.songs.unique, "one")}, across {r.songs.setlists} {plural(r.songs.setlists, "setlist")}</p>
      {r.songs.debuts.length > 0 && <p className={s.foot}>{r.songs.debuts.length} made {r.songs.debuts.length === 1 ? "its" : "their"} live debut: {r.songs.debuts.slice(0, 3).join(", ")}{r.songs.debuts.length > 3 ? " and more" : ""}.</p>}
    </>);
    add("topSongs", s.night, <>
      <p className={s.kicker}>Your most-played {plural(r.songs.top.length, "song")}</p>
      <RankList rows={r.songs.top} />
      {(r.songs.opener || r.songs.closer) && <p className={s.foot}>
        {r.songs.opener && `Favorite opener: ${r.songs.opener.name}. `}
        {r.songs.closer && `Favorite closer: ${r.songs.closer.name}.`}
      </p>}
    </>);
  }

  if (r.songs.stageSec >= 600) {
    add("stage", s.orange, <>
      <p className={s.kicker}>You spent</p>
      <p className={s.big}><Count n={r.songs.stageSec} format={hours} /></p>
      <p className={s.unit}>{hours(r.songs.stageSec) === "1" ? "hour" : "hours"} on stage</p>
      {p && p.songs.stageSec > 0 && vs(r.songs.stageSec, p.songs.stageSec, (n) => `${hours(n)} ${hours(n) === "1" ? "hour" : "hours"}`)}
      <p className={s.line}>{stageLine(r.songs.stageSec)}</p>
    </>);
  }

  if (r.rehearsals.count) {
    add("rehearsals", s.berry, <>
      <p className={s.kicker}>It took practice</p>
      <p className={s.big}><Count n={r.rehearsals.count} /></p>
      <p className={s.unit}>{plural(r.rehearsals.count, "rehearsal")}</p>
      {vs(r.rehearsals.count, p?.rehearsals.count)}
      <p className={s.line}>
        {r.rehearsals.sec > 0 && <><b>{hours(r.rehearsals.sec)}</b> {hours(r.rehearsals.sec) === "1" ? "hour" : "hours"} in the room</>}
        {r.rehearsals.sec > 0 && r.rehearsals.songs > 0 && ", "}
        {r.rehearsals.songs > 0 && <><b>{r.rehearsals.songs}</b> {plural(r.rehearsals.songs, "song")} worked on</>}
      </p>
      {r.rehearsals.top && r.rehearsals.top.count > 1 && <p className={s.foot}>Most rehearsed: {r.rehearsals.top.name}, {r.rehearsals.top.count} times.</p>}
    </>);
  }

  if (r.miles.total) {
    add("miles", s.green, <>
      <p className={s.kicker}>You drove</p>
      <p className={big(num(r.miles.total))}><Count n={r.miles.total} /></p>
      <p className={s.unit}>{plural(r.miles.total, "mile")}</p>
      {p && p.miles.total > 0 && vs(r.miles.total, p.miles.total, (n) => `${num(n)} ${plural(Math.round(n), "mile")}`)}
      <p className={s.line}>{milesLine(r.miles.total)}</p>
      <p className={s.foot}>
        {r.miles.trips} {plural(r.miles.trips, "trip")}
        {r.miles.gasCents > 0 && `, ${bucks(r.miles.gasCents)} in gas`}
        {r.miles.tourDrives > 0 && `, ${num(r.miles.tourDrives)} of those miles on tour`}.
      </p>
    </>);
  }

  if (r.crowd.total || r.crowd.rated) {
    add("crowd", s.sky, r.crowd.total ? <>
      <p className={s.kicker}>You played to</p>
      <p className={big(num(r.crowd.total))}><Count n={r.crowd.total} /></p>
      <p className={s.unit}>{plural(r.crowd.total, "person", "people")}</p>
      {p && p.crowd.total > 0 && vs(r.crowd.total, p.crowd.total)}
      {r.crowd.biggest && r.crowd.counted > 1 && <p className={s.line}>Biggest crowd: <b>{num(r.crowd.biggest.count)}</b> at {r.crowd.biggest.name}</p>}
      {r.crowd.avgStars !== undefined && <p className={s.foot}>You gave your shows {r.crowd.avgStars} stars on average{r.crowd.fiveStar > 0 ? `, and ${r.crowd.fiveStar} got all five` : ""}.</p>}
    </> : <>
      <p className={s.kicker}>How&apos;d it go?</p>
      <p className={s.big}><Count n={r.crowd.avgStars ?? 0} format={(n) => String(Math.round(n * 10) / 10)} /></p>
      <p className={s.unit}>stars on average</p>
      <p className={s.line}>{r.crowd.rated} {plural(r.crowd.rated, "show")} rated{r.crowd.fiveStar > 0 ? <>, <b>{r.crowd.fiveStar}</b> with all five</> : ""}</p>
    </>);
  }

  if (r.money.in || r.money.out) {
    add("money", s.night, <>
      <p className={s.kicker}>You made</p>
      <p className={big(bucks(r.money.in))} data-testid="review-money-in"><Count n={r.money.in} format={bucks} /></p>
      {vs(r.money.in, p?.money.in, bucks)}
      <p className={s.line}>
        {bucks(r.money.out)} went out, so the year {r.soFar ? "is" : "ended"} <b>{r.money.net >= 0 ? `${bucks(r.money.net)} up` : `${bucks(-r.money.net)} down`}</b>
      </p>
      {r.money.sources.length > 0 && <RankList rows={r.money.sources.slice(0, 4).map((x) => ({ name: x.name, count: x.cents }))} unit={bucks} />}
      <p className={s.foot}>
        {r.money.bestShow && `Best night: ${r.money.bestShow.name}, ${bucks(r.money.bestShow.cents)}. `}
        {r.money.perShow > 0 && r.shows.count > 1 && `${bucks(r.money.perShow)} a show on average. `}
        {r.money.paidToPlayers > 0 && `${bucks(r.money.paidToPlayers)} paid to players.`}
      </p>
    </>);
  }

  if (r.lineups.byConfig.length || r.lineups.players.length) {
    const cfg = r.lineups.byConfig.length > 0;
    add("lineups", s.pink, <>
      <p className={s.kicker}>{cfg ? "Who showed up" : "Most shows played"}</p>
      <RankList rows={cfg ? r.lineups.byConfig : r.lineups.players.slice(0, 5)} unit={(n) => `${n} ${plural(n, "show")}`} />
      {cfg && r.lineups.mvp && <p className={s.line}>Iron player: <b>{r.lineups.mvp.name}</b>, on stage for {r.lineups.mvp.count} {plural(r.lineups.mvp.count, "show")}</p>}
      {r.shows.byKind.length > 1 && <p className={s.foot}>{r.shows.byKind.map((k) => `${k.count} ${k.name.toLowerCase()}`).join(", ")}.</p>}
    </>);
  }

  if (r.releases.out.length || r.songs.added || r.releases.coming) {
    const rel = r.releases.out;
    add("music", s.orange, rel.length ? <>
      <p className={s.kicker}>You put out</p>
      {rel.length === 1 ? <h2 className={s.title}>{rel[0].title}</h2> : <><p className={s.big}><Count n={rel.length} /></p><p className={s.unit}>releases</p></>}
      <p className={s.line}>
        {rel.length === 1
          ? <>{rel[0].kind === "single" ? "A" : "An"} {RELEASE_KIND[rel[0].kind] ?? rel[0].kind}{rel[0].tracks > 1 && <> with <b>{rel[0].tracks}</b> tracks</>}, out {fmtDate(rel[0].date)}</>
          : <>{rel.map((x) => x.title).join(", ")}{r.releases.tracks > 0 && <>: <b>{r.releases.tracks}</b> tracks in all</>}</>}
      </p>
      {r.songs.added > 0 && <p className={s.foot}>{r.songs.added} new {plural(r.songs.added, "song")} joined the songbook.{r.releases.coming > 0 && ` ${r.releases.coming} more ${plural(r.releases.coming, "release")} still to come this year.`}</p>}
    </> : r.songs.added ? <>
      <p className={s.kicker}>The songbook grew by</p>
      <p className={s.big}><Count n={r.songs.added} /></p>
      <p className={s.unit}>{plural(r.songs.added, "song")}</p>
      {r.releases.coming > 0 && <p className={s.line}>And <b>{r.releases.coming}</b> {plural(r.releases.coming, "release")} still to come this year.</p>}
    </> : <>
      <p className={s.kicker}>Still to come this year</p>
      <p className={s.big}><Count n={r.releases.coming} /></p>
      <p className={s.unit}>{plural(r.releases.coming, "release")}</p>
    </>);
  }

  const reach: [string, string][] = [];
  if (r.reach.newFans) reach.push([num(r.reach.newFans), `new ${plural(r.reach.newFans, "fan")} on the list${r.reach.fanCities > 1 ? `, from ${r.reach.fanCities} towns` : ""}`]);
  if (r.reach.followers && r.reach.followers.to !== r.reach.followers.from) {
    const d = r.reach.followers.to - r.reach.followers.from;
    reach.push([`${d > 0 ? "+" : ""}${num(d)}`, `Spotify followers (now ${num(r.reach.followers.to)})`]);
  } else if (r.reach.followers) reach.push([num(r.reach.followers.to), "Spotify followers"]);
  if (r.reach.monthlyListeners) reach.push([num(r.reach.monthlyListeners), "monthly listeners"]);
  if (r.reach.streams) reach.push([num(r.reach.streams), "streams"]);
  if (r.reach.posts) reach.push([num(r.reach.posts), `${plural(r.reach.posts, "post")} on Instagram`]);
  if (r.reach.pitches) reach.push([num(r.reach.pitches), `${plural(r.reach.pitches, "pitch", "pitches")} sent${r.reach.booked ? `, ${r.reach.booked} booked` : ""}`]);
  if (reach.length) {
    add("reach", s.aqua, <>
      <p className={s.kicker}>The word got out</p>
      <div className={s.tiles}>{reach.slice(0, 6).map(([n, label]) => <div key={label} className={s.tile}><b>{n}</b><span>{label}</span></div>)}</div>
    </>);
  }

  if (prev && p) {
    const duels: React.ReactNode[] = [];
    const duel = (label: string, now: number, before: number, fmt?: (n: number) => string) => { if (now || before) duels.push(<Duel key={label} label={label} now={now} before={before} fmt={fmt} />); };
    duel("Shows", r.shows.count, p.shows.count);
    duel("Songs played", r.songs.played, p.songs.played);
    duel("Hours on stage", r.songs.stageSec, p.songs.stageSec, hours);
    duel("Miles", r.miles.total, p.miles.total);
    duel("Money made", r.money.in, p.money.in, bucks);
    duel("Rehearsals", r.rehearsals.count, p.rehearsals.count);
    if (duels.length > 1) {
      add("versus", s.berry, <>
        <p className={s.kicker}><span className={s.keyNow}>{r.year}</span> vs <span className={s.keyBefore}>{prev.year}</span></p>
        <div className={s.duels}>{duels.slice(0, 5)}</div>
        <p className={s.foot}>{prev.samePoint && prev.through ? `Both years through ${fmtDate(prev.through)}.` : `All of ${r.year} against all of ${prev.year}.`}</p>
      </>);
    }
  }

  if (out.length === 1) {
    add("empty", s.night, <>
      <p className={s.kicker}>Nothing logged for {r.year} yet</p>
      <p className={s.line}>Play a show, log a rehearsal or add some money, and it will turn up here.</p>
    </>);
    return out;
  }

  const tiles: [string, string][] = [];
  if (r.shows.count) tiles.push([num(r.shows.count), plural(r.shows.count, "show")]);
  if (r.songs.played) tiles.push([num(r.songs.played), `${plural(r.songs.played, "song")} played`]);
  if (r.songs.unique) tiles.push([num(r.songs.unique), `different ${plural(r.songs.unique, "song")}`]);
  if (r.songs.stageSec >= 600) tiles.push([hours(r.songs.stageSec), "hours on stage"]);
  if (r.miles.total) tiles.push([num(r.miles.total), "miles driven"]);
  if (r.money.in) tiles.push([bucks(r.money.in), "made"]);
  if (r.rehearsals.count) tiles.push([num(r.rehearsals.count), plural(r.rehearsals.count, "rehearsal")]);
  if (r.releases.out.length) tiles.push([num(r.releases.out.length), plural(r.releases.out.length, "release")]);
  if (r.crowd.total) tiles.push([num(r.crowd.total), "people played to"]);
  if (r.reach.newFans) tiles.push([num(r.reach.newFans), `new ${plural(r.reach.newFans, "fan")}`]);
  add("summary", s.violet, <>
    <span className={s.tag}>{band} · {r.year}{r.soFar ? " so far" : ""}</span>
    <h2 className={s.title}>What a year.</h2>
    <div className={s.tiles} data-testid="review-tiles">{tiles.slice(0, 8).map(([n, label]) => <div key={label} className={s.tile}><b>{n}</b><span>{label}</span></div>)}</div>
  </>);
  return out;
}

const Chevron = ({ d }: { d: string }) => <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

/**
 * The Year in Review page: one stat per full-screen slide, like a story. Tap or click the right side (or → / space) to go on,
 * the left side (←) to go back, hold to pause, swipe either way, Esc or ✕ to leave. It moves on by itself every 8 seconds
 * unless the device asks for reduced motion. `?y=2025` picks the year.
 */
export function YearReview() {
  const { name } = useArtist();
  const router = useArtistRouter();
  const q = useSearchParams().get("y") ?? "";
  const tz = useZone();
  const today = todayStr(tz);
  const year = /^\d{4}$/.test(q) ? q : defaultReviewYear(today);
  const { review, previous, years, loading, error, feeds } = useReviewData(year);
  const slides = useMemo(() => (review ? slidesFor(review, name, previous) : []), [review, name, previous]);

  // The slide you're on belongs to the year it was reached in: another year starts over.
  const [pos, setPos] = useState({ year, i: 0 });
  const i = pos.year === year ? Math.min(pos.i, Math.max(0, slides.length - 1)) : 0;
  const last = slides.length > 0 && i === slides.length - 1;
  const go = useCallback((to: number) => setPos({ year, i: Math.max(0, Math.min(slides.length - 1, to)) }), [year, slides.length]);
  const next = useCallback(() => go(i + 1), [go, i]);
  const prev = useCallback(() => go(i - 1), [go, i]);
  const close = useCallback(() => router.push("/calendar"), [router]);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [next, prev, close]);

  const current = slides[i];
  useEffect(() => { if (current?.key === "summary") confetti(); }, [current?.key, year]);

  // A hold pauses, a sideways drag is a swipe; either one swallows the click that follows.
  const g = useRef({ x: 0, t: 0, used: false });
  const zone = (dir: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { g.current = { x: e.clientX, t: Date.now(), used: false }; setHeld(true); },
    onPointerUp: (e: React.PointerEvent) => {
      setHeld(false);
      const dx = e.clientX - g.current.x;
      if (Math.abs(dx) > 40) { g.current.used = true; if (dx < 0) next(); else prev(); }
      else if (Date.now() - g.current.t > 350) g.current.used = true;
    },
    onPointerCancel: () => setHeld(false),
    onPointerLeave: () => setHeld(false),
    onClick: () => { if (g.current.used) { g.current.used = false; return; } dir(); },
  });

  return (
    <div className={`${s.root} ${current?.palette ?? s.violet}`} data-testid="review-page" data-last={current?.key === "summary" ? "1" : undefined} style={{ background: "var(--bg)" }}>
      {feeds}
      {current
        ? <section key={`${year}:${current.key}`} className={s.slide} data-testid="review-slide" data-slide={current.key} aria-live="polite">
          <span className={`${s.blob} ${s.blob1}`} aria-hidden /><span className={`${s.blob} ${s.blob2}`} aria-hidden /><span className={s.ring} aria-hidden />
          <div className={s.inner}>
            {current.body}
          </div>
        </section>
        : <div className={s.wait} data-testid={error ? "review-error" : "review-loading"}>
          {error ? <><p className={s.title}>That didn&apos;t load.</p><p className={s.line}>{error}</p></> : loading ? <p className={`${s.title} ${s.pulse}`}>Adding up {year}…</p> : null}
        </div>}

      {slides.length > 0 && <>
        <button type="button" className={`${s.zone} ${s.prev}`} aria-label="Previous" data-testid="review-prev" disabled={i === 0} {...zone(prev)}><Chevron d="M15 5l-7 7 7 7" /></button>
        <button type="button" className={`${s.zone} ${s.next}`} aria-label="Next" data-testid="review-next" disabled={last} {...zone(next)}><Chevron d="M9 5l7 7-7 7" /></button>
      </>}

      {current?.key === "summary" && (
        <div className={s.actions}>
          <button type="button" className={s.action} data-testid="review-again" onClick={() => go(0)}>Play it again</button>
          <button type="button" className={`${s.action} ${s.quiet}`} data-testid="review-done" onClick={close}>Done</button>
        </div>
      )}

      <header className={s.top}>
        <div className={s.progress} data-testid="review-progress" role="progressbar" aria-label="Slide" aria-valuemin={1} aria-valuemax={slides.length || 1} aria-valuenow={i + 1}>
          {slides.map((sl, n) => (
            <span key={`${year}:${sl.key}`} className={`${s.seg}${n < i ? ` ${s.done}` : n === i ? ` ${s.on}${held ? ` ${s.hold}` : ""}` : ""}`}>
              <i key={n === i ? "on" : "off"} onAnimationEnd={n === i && !last ? next : undefined} />
            </span>
          ))}
        </div>
        <div className={s.bar2}>
          <span className={s.band}>{name}</span>
          <select className={s.year} aria-label="Year" data-testid="review-year" value={year} onChange={(e) => router.replace(`/review?y=${e.target.value}`)}>
            {(years.includes(year) ? years : [year, ...years].sort().reverse()).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" className={s.iconBtn} aria-label="Close" data-testid="review-close" onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </header>
    </div>
  );
}
