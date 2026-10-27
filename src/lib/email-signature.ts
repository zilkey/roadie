/**
 * What a signature gives away. People lists who the admin has emailed with at a place; the title and phone number are read from
 * the bottom of the newest message that person sent: the last 6 non-empty lines, a line with a phone number gives the phone,
 * the line after the one that is their name gives the title. It is a guess, and the UI says to check it.
 */
import { splitQuoted } from "./email-text";

export interface SignatureFacts { title?: string; phone?: string }

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const noise = (l: string) => PHONE.test(l) || /@/.test(l) || /https?:\/\/|www\./i.test(l) || /^[-_=*~\s]*$/.test(l);

export function signatureOf(body: string, displayName: string): SignatureFacts {
  const lines = splitQuoted(body).text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-6);
  const out: SignatureFacts = {};
  const ph = lines.map((l) => PHONE.exec(l)?.[0]).filter((x): x is string => !!x);
  if (ph.length) out.phone = ph[ph.length - 1].trim();
  const name = norm(displayName);
  if (name) {
    const at = lines.findIndex((l) => norm(l.replace(/^[-–—~\s]+/, "")) === name);
    const next = at >= 0 ? lines[at + 1] : undefined;
    if (next && !noise(next) && next.length <= 80) out.title = next;
  }
  return out;
}

/** "booking@lostlake.example" -> "Booking"; "haylee.jackson+x@..." -> "Haylee Jackson". For a contact with no display name to go on. */
export function nameFromAddress(addr: string): string {
  const local = addr.split("@")[0].split("+")[0];
  const words = local.split(/[._-]+/).filter(Boolean);
  return (words.length ? words : [addr]).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
