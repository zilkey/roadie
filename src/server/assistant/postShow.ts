/**
 * After the show (#69): someone counting cash and checking Venmo tells Roadie about the night. Each amount becomes its
 * own Yes / Cancel card, and a card ends the message, so the model never gets to say what it understood or ask what is
 * still missing. The app says both itself, from the cards it just made: one line with every amount and the total
 * ("always show what it understood before saving"), and one question about the crowd and the stars when the show has
 * neither yet. Both are plain arithmetic on the cards' own inputs, never the model's.
 */
import { INCOME_LABEL, METHOD_LABEL } from "@/lib/money";
import { db } from "../db";
import { dateInBandZone } from "@/lib/timezone";

/** A confirm card made this message: its command and input, the payee's name, and for a record named by id its amount and who it is from. */
export interface MoneyCard { command: string; input: unknown; person?: string; amount?: number; from?: string }
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const method = (m: unknown) => (typeof m === "string" ? ` ${(METHOD_LABEL[m] ?? m).replace(/^(Cash|Check|Card|Bank|Other)$/, (x) => x.toLowerCase())}` : "");
export const TAP_EACH = "Tap Yes on each card, or tell me what's off.";
export const ASK_CROWD = "How many people came?";
export const ASK_STARS = "How'd it go: stars for the show and the venue, anything to note?";

/** "Here's what I heard: door $300 cash, merch $90 cash, tips $22 cash. That's $412 in." For two or more money cards; one card says it all itself. */
export function heard(cards: MoneyCard[]): string | undefined {
  const lines: string[] = [], paid: string[] = [];
  let got = 0, owed = 0, out = 0;
  for (const c of cards) {
    const i = (c.input ?? {}) as Row;
    if (c.command === "income.add") {
      lines.push(`${(INCOME_LABEL[i.category] ?? String(i.category)).toLowerCase()} ${dollars(i.amount)}${i.receivedAt ? method(i.method) : " still owed"}`);
      if (i.receivedAt) got += i.amount; else owed += i.amount;
    } else if (c.command === "income.setReceived" && c.amount) {
      lines.push(`${c.from ? `${c.from}'s ` : ""}${dollars(c.amount)} received${method(i.method)}`);
      got += c.amount;
    } else if (c.command === "payouts.add") {
      paid.push(`${c.person ?? i.to?.name ?? "someone"} ${dollars(i.amount)}${i.paidAt ? "" : " (owed)"}`);
      out += i.amount;
    }
  }
  if (lines.length + paid.length < 2) return undefined;
  const totals = [got ? `${dollars(got)} in` : "", owed ? `${dollars(owed)} still owed to us` : "", out ? `${dollars(out)} to the band` : ""].filter(Boolean).join(", ");
  return `Here's what I heard: ${[...lines, ...(paid.length ? [`paid ${paid.join(", ")}`] : [])].join(", ")}. That's ${totals}. ${TAP_EACH}`;
}

/** The show the money cards are for, when they all name the same one. */
export function showOf(cards: MoneyCard[]): string | undefined {
  const ids = new Set(cards.filter((c) => c.command === "income.add" || c.command === "payouts.add").map((c) => (c.input as Row | null)?.showId).filter((x): x is string => typeof x === "string"));
  return ids.size === 1 ? [...ids][0] : undefined;
}

/**
 * What to ask after money went on a show: the crowd and the stars, when the show has neither and Roadie hasn't asked in
 * this conversation yet (she may have said "that's it"). Nothing when the reply already asks something, when no money
 * actually changed hands (a guarantee still owed), or when the show hasn't happened yet.
 */
export async function stillMissing(cards: MoneyCard[], reply: string, history: { role: string; text: string }[]): Promise<string | undefined> {
  const showId = showOf(cards);
  if (!showId || reply.includes("?")) return undefined;
  if (!cards.some((c) => { const i = (c.input ?? {}) as Row; return i.receivedAt || i.paidAt; })) return undefined;
  const show = await db.get("shows", showId);
  if (!show || (show.date as string) > dateInBandZone()) return undefined;
  const before = history.filter((h) => h.role === "assistant").map((h) => h.text).join("\n");
  const deal = ((await db.get("showDeals", showId)) ?? {}) as Row;
  const ask = [
    deal.crowd === undefined && !before.includes(ASK_CROWD) ? ASK_CROWD : "",
    deal.rating?.show === undefined && deal.rating?.venue === undefined && !before.includes(ASK_STARS) ? ASK_STARS : "",
  ].filter(Boolean);
  return ask.length ? ask.join(" ") : undefined;
}
