"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { useBooking } from "@/components/booking/common";
import { AUTO_CHECK_MS, agoText } from "@/lib/email-text";
import { hasNewReply, type EmailThread } from "@/schema";

type Stamp = { toMillis(): number };
const ms = (t?: unknown) => (t as Stamp | undefined)?.toMillis?.() ?? 0;
/** When Roadie last read the thread from Gmail. */
const checkedAt = (t: EmailThread) => ms(t.syncedAt) || ms((t as unknown as { updatedAt?: unknown }).updatedAt);
const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE });

/**
 * The Email card on a pitch: the Gmail threads of the pitch's place (venue, promoter or festival), newest first. Threads
 * belong to the place, so they stay when the pitch closes. New email opens the compose page for this pitch.
 */
export function EmailCard({ target, pitchId }: { target: { kind: "venue" | "promoter" | "edition"; id: string }; pitchId: string }) {
  const { artistId } = useArtist();
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const [result, setResult] = useState<string | null>(null);

  // A thread belongs to the place: an edition's threads are on its festival.
  const place = useMemo(() => {
    if (target.kind !== "edition") return { kind: target.kind, id: target.id };
    const e = b.editions.find((x) => x.id === target.id);
    return e ? { kind: "festival" as const, id: e.festivalId } : null;
  }, [target.kind, target.id, b.editions]);
  const { rows } = useCollection<EmailThread>("emailThreads", { where: [["artistId", "==", artistId], ["target.id", "==", place?.id ?? ""]], skip: !place });
  const threads = useMemo(() => (rows ?? []).filter((t) => t.target.kind === place?.kind).sort((x, y) => y.lastDate.localeCompare(x.lastDate)), [rows, place?.kind]);

  const newest = threads.reduce((m, t) => Math.max(m, checkedAt(t)), 0);
  const word = place?.kind === "festival" ? "festival" : place?.kind === "promoter" ? "promoter" : "venue";

  async function check(quiet = false) {
    if (!place) return;
    const r = await call<{ added: number }>("email.sync", { target: { kind: place.kind, id: place.id } });
    if (r && !quiet) setResult(r.added ? `${r.added} new repl${r.added === 1 ? "y" : "ies"}` : "No new replies");
  }

  // On opening the pitch: read the threads again if they were last read a while ago. Once, no polling.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || rows === null || !place || !threads.length) return;
    auto.current = true;
    if (Date.now() - newest > AUTO_CHECK_MS) void check(true);
  }, [rows, place, threads.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (addr: string) => b.contacts.find((c) => c.emails.includes(addr))?.name ?? addr;

  return (
    <section className="card" data-testid="pitch-email-card">
      <div className="card-head">
        <h2>Email · {threads.length} thread{threads.length === 1 ? "" : "s"}</h2>
        <div className="flex items-center gap-2">
          <Link href={`/booking/email/search?target=${target.kind}:${target.id}${pitchId ? `&pitch=${pitchId}` : ""}`} className="btn sm" data-testid="search-gmail">Search Gmail</Link>
          <Link href={`/booking/email/new?target=${target.kind}:${target.id}&pitch=${pitchId}`} className="btn acc" data-testid="email-new">New email</Link>
        </div>
      </div>
      <ErrorBox error={error} />
      {rows !== null && threads.length === 0 && <div className="empty" data-testid="email-empty"><span>No threads yet. Send one from here, or link one from Gmail.</span></div>}
      {threads.length > 0 && (
        <div className="grid gap-1" data-testid="email-threads">
          {threads.map((t) => {
            const who = t.participants[0] ?? t.lastFrom;
            const isNew = hasNewReply(t);
            return (
              <Link key={t.id} href={`/booking/email/${t.id}`} className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }} data-testid={`thread-${t.id}`}>
                <span className="avatar" aria-hidden>{nameOf(who).charAt(0).toUpperCase()}</span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="truncate">{t.subject || "(no subject)"}</b>
                    <span className="chip m" data-testid={`thread-count-${t.id}`}>{t.messageCount}</span>
                    {isNew && <span className="chip a" data-testid={`thread-new-${t.id}`}>New reply</span>}
                  </span>
                  <span className="s truncate">{t.participants.map(nameOf).join(", ")}</span>
                  <span className="line-clamp-2 text-sm">{t.snippet}</span>
                </span>
                <span className="s shrink-0">{short(t.lastDate)}</span>
              </Link>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="s">Threads belong to the {word}, so they stay when this pitch closes. New replies show up on their own.</span>
        <span className="flex items-center gap-2 s">
          <span data-testid="checked">Checked {newest ? agoText(newest) : "never"}</span> ·
          <button type="button" className="btn sm ghost" onClick={() => void check()} disabled={busy || !place} data-testid="check-replies">Check now</button>
          {result && <span data-testid="replies-result">{result}</span>}
        </span>
      </div>
    </section>
  );
}
