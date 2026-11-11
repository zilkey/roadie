/** A piece of chat text: plain, or a link to open in a new tab. */
export type Segment = { text: string; href?: string };

// A markdown link [label](https://...), or a bare http(s) URL.
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"]+/gi;

/** Trailing punctuation belongs to the sentence, not the URL; a ")" stays only when it closes a "(" in the URL. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"*_]+$/, "");
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1).replace(/[.,;:!?'"*_]+$/, "");
  return u;
}

/** Splits text into plain runs and http(s) links. Only http(s): never javascript:, mailto: or relative links. */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  const plain = (s: string) => { if (!s) return; const last = out[out.length - 1]; if (last && !last.href) last.text += s; else out.push({ text: s }); };
  for (const m of text.matchAll(LINK)) {
    plain(text.slice(at, m.index));
    if (m[1]) {
      out.push({ text: m[1], href: m[2] });
      at = m.index + m[0].length;
    } else {
      const url = trimUrl(m[0]);
      out.push({ text: url, href: url });
      at = m.index + url.length;
    }
  }
  plain(text.slice(at));
  return out;
}
