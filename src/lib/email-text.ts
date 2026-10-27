/**
 * Plain-text mail bodies: where the quoted part starts. Everything from a line like "On Tue, Dec 2 ... wrote:" or from the
 * first line that starts with ">" onward is the quote. Used for thread snippets (server) and for the thread page.
 */
export function splitQuoted(body: string): { text: string; quoted: string } {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((l) => /^On .+ wrote:$/.test(l.trim()) || l.trimStart().startsWith(">"));
  if (at < 0) return { text: body.trim(), quoted: "" };
  return { text: lines.slice(0, at).join("\n").trim(), quoted: lines.slice(at).join("\n").trim() };
}

/** The first `max` characters of the unquoted text on one line. */
export function snippetOf(body: string, max = 160): string {
  const t = splitQuoted(body).text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago": how long ago, for "Checked …". */
export function agoText(thenMs: number, nowMs = Date.now()): string {
  const min = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** The auto-check runs when the newest thread was last read more than this long ago. */
export const AUTO_CHECK_MS = 10 * 60_000;
