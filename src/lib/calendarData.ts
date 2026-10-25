"use client";
import { useMemo } from "react";
import { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { STATUS_LABEL, isActive, sortedDates, datePast, todayStr, type Status } from "@/lib/booking";
import { fmtTime, showName } from "@/lib/shows";
import { upcoming, type CalendarItem } from "@/lib/calendar";
import type { Show, Rehearsal, Festival, Edition, Pitch } from "@/schema";

const addDay = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
};

/**
 * Everything the Calendar page draws. Shows and rehearsals load for everyone (same unfiltered queries as the Shows and
 * Rehearsals pages); festivals, editions and pitches are admin-only and skipped for members.
 * `comingUp` is the next 6 opens/deadlines of editions not yet acted on (admins only).
 */
export function useCalendarItems(): { items: CalendarItem[]; comingUp: CalendarItem[]; loading: boolean; admin: boolean } {
  const { role } = useArtist();
  const admin = role === "admin";
  const shows = useCollection<Show>("shows");
  const rehearsals = useCollection<Rehearsal>("rehearsals");
  const festivals = useCollection<Festival>("festivals", { skip: !admin });
  const editions = useCollection<Edition>("editions", { skip: !admin });
  const pitches = useCollection<Pitch>("pitches", { skip: !admin });
  const loading = [shows, rehearsals, festivals, editions, pitches].some((c) => c.loading);

  const showRows = shows.rows, rehearsalRows = rehearsals.rows, festivalRows = festivals.rows, editionRows = editions.rows, pitchRows = pitches.rows;
  return useMemo(() => {
    const today = todayStr();
    const items: CalendarItem[] = [];

    for (const s of showRows ?? []) {
      if ((s.status !== "hold" && s.status !== "confirmed") || s.date < today) continue;
      const city = s.venue?.city ?? s.place?.city;
      const status = s.status === "hold" ? "Hold" : "Confirmed";
      items.push({
        id: `show:${s.id}:${s.date}`, date: s.date, kind: "show", sourceId: s.id, href: `/shows/${s.id}`,
        title: showName(s) || s.place?.city || "Show", subtitle: city ? `${status} · ${city}` : status,
      });
    }

    for (const r of rehearsalRows ?? []) {
      if (r.date < today) continue;
      const sub = [r.location?.name, r.startTime ? fmtTime(r.startTime) : ""].filter(Boolean).join(" · ");
      items.push({ id: `rehearsal:${r.id}:${r.date}`, date: r.date, kind: "rehearsal", sourceId: r.id, href: `/rehearsals/${r.id}`, title: "Rehearsal", subtitle: sub });
    }

    const comingUp: CalendarItem[] = [];
    if (admin) {
      for (const p of pitchRows ?? []) {
        if (!isActive(p.status)) continue;
        for (const d of sortedDates(p.dates)) {
          items.push({
            id: `pitchDate:${p.id}:${d}`, date: d, kind: "pitchDate", sourceId: p.id, href: `/booking/pitches/${p.id}`,
            title: p.target.name, subtitle: STATUS_LABEL[p.status as Status] ?? p.status, past: datePast(d, today),
          });
        }
      }

      const festType = new Map((festivalRows ?? []).map((f) => [f.id, f.type]));
      for (const e of editionRows ?? []) {
        const href = `/booking/editions/${e.id}`;
        const base = { sourceId: e.id, href, title: e.festivalName };
        const sub = e.label ?? "";
        const edItems: CalendarItem[] = [];
        if (e.appOpens?.date) {
          const est = e.appOpens.sure === "estimated";
          edItems.push({ ...base, id: `opens:${e.id}:${e.appOpens.date}`, date: e.appOpens.date, kind: "opens", estimated: est || undefined, subtitle: sub });
        }
        if (e.appDeadline?.date) {
          const sure = e.appDeadline.sure;
          edItems.push({
            ...base, id: `deadline:${e.id}:${e.appDeadline.date}`, date: e.appDeadline.date, kind: "deadline",
            estimated: sure === "estimated" || undefined, target: sure === "target" || undefined, subtitle: sub,
          });
        }
        const acted = (pitchRows ?? []).some((p) => p.target.kind === "edition" && p.target.id === e.id && p.status !== "idea" && p.status !== "toPitch");
        if (!acted) comingUp.push(...edItems);

        const start = e.startDate;
        if (start) {
          if (festType.get(e.festivalId) === "series") {
            edItems.push({ ...base, id: `seriesStart:${e.id}:${start}`, date: start, kind: "seriesStart", subtitle: sub });
          } else {
            const end = e.endDate && e.endDate > start ? e.endDate : start;
            for (let d = start, n = 0; d <= end && n < 60; d = addDay(d), n++) {
              edItems.push({ ...base, id: `festivalDay:${e.id}:${d}`, date: d, kind: "festivalDay", subtitle: sub, firstDay: d === start || undefined });
            }
          }
        }
        items.push(...edItems);
      }
    }

    return { items, comingUp: admin ? upcoming(comingUp, today, 6) : [], loading, admin };
  }, [showRows, rehearsalRows, festivalRows, editionRows, pitchRows, admin, loading]);
}
