/**
 * iCalendar feeds (a ticketing site's .ics, a WordPress `?ical=1` feed, a public Google Calendar basic.ics). Tiny parser: unfolds
 * lines, reads each VEVENT's UID, SUMMARY, DTSTART, URL, DESCRIPTION and STATUS. Recurrence (RRULE) is not expanded: a repeating
 * event shows once, on its first date. Only events from a week ago on are kept. A poster comes from IMAGE (RFC 7986) or an image ATTACH.
 */
import type { RawEvent, Reader } from "../types";

const unescape = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** "DTSTART;TZID=X:2026..." → value and params. */
function parseLine(l: string): { name: string; params: string; value: string } | undefined {
  const i = l.indexOf(":");
  if (i < 0) return undefined;
  const head = l.slice(0, i), j = head.indexOf(";");
  return { name: (j < 0 ? head : head.slice(0, j)).toUpperCase(), params: j < 0 ? "" : head.slice(j + 1), value: l.slice(i + 1) };
}

/** 20261114T200000Z → an ISO instant; 20261114T200000 (any TZID) → local; 20261114 → the date. */
function dtstart(value: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return d;
  return `${d}T${m[4]}:${m[5]}:${m[6] ?? "00"}${m[7] ? "Z" : ""}`;
}

/** IMAGE;VALUE=URI:https://… or ATTACH;FMTTYPE=image/jpeg:https://… (not inline binary). */
function image(cur: Record<string, { params: string; value: string }>): string | undefined {
  const p = cur.IMAGE ?? (cur.ATTACH && /fmttype=image\//i.test(cur.ATTACH.params) ? cur.ATTACH : undefined);
  if (!p || /encoding=base64/i.test(p.params)) return undefined;
  return p.value.trim() || undefined;
}

export function parseIcs(body: string): RawEvent[] {
  const lines = body.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: RawEvent[] = [];
  let cur: Record<string, { params: string; value: string }> | undefined;
  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") { cur = {}; continue; }
    if (raw === "END:VEVENT") {
      if (cur?.SUMMARY && cur.DTSTART) {
        const startsAt = dtstart(cur.DTSTART.value);
        let title = unescape(cur.SUMMARY.value);
        // Ticketing feeds write "***SOLD OUT***" into the summary; calendars write "CANCELED " in front.
        const soldOut = /\*+\s*sold out\s*\*+/i.test(title);
        if (soldOut) title = title.replace(/\s*\*+\s*sold out\s*\*+\.?/i, "").trim();
        const status = cur.STATUS?.value.trim().toUpperCase() === "CANCELLED" || /^\s*cancell?ed\b/i.test(title) ? "cancelled" : soldOut ? "soldout" : undefined;
        if (startsAt) {
          out.push({
            sourceId: cur.UID?.value.trim(), title, startsAt,
            ...(cur.URL ? { ticketUrl: cur.URL.value.trim() } : {}),
            ...(image(cur) ? { imageUrl: image(cur) } : {}),
            ...(status ? { status } : {}),
            ...(cur.LOCATION ? { venueName: unescape(cur.LOCATION.value) } : {}),
            ...(cur.DESCRIPTION ? { description: unescape(cur.DESCRIPTION.value).replace(/\s+/g, " ").trim().slice(0, 400) } : {}),
          });
        }
      }
      cur = undefined;
      continue;
    }
    if (!cur) continue;
    const l = parseLine(raw);
    if (l && !(l.name in cur)) cur[l.name] = { params: l.params, value: l.value };
  }
  return out;
}

export const readIcs: Reader<"ics"> = async (cal, ctx) => {
  const accept = "text/calendar,text/plain,*/*;q=0.5";
  // Some hosts reset a connection that claims to be Chrome from a script; a bare UA gets through.
  const page = await ctx.net.raw(cal.url, { accept }).catch(() => ctx.net.raw(cal.url, { accept, headers: { "user-agent": "Mozilla/5.0" } }));
  const floor = ctx.now.getTime() - 7 * 86_400_000;
  // Compare on the date alone (a local time has no offset): a day of slack either way is fine.
  const events = parseIcs(page.body).filter((e) => Date.parse(e.startsAt!.slice(0, 10)) >= floor - 86_400_000);
  return { events, bill: "title" };
};
