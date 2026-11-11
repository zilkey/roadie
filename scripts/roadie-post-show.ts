/**
 * Post-show chats (#69): someone in the passenger seat after the show, cash in her hand, telling Roadie about the night.
 * Each conversation here is a scenario for `npm run eval:roadie` (names start "post-show-"): the words she says, turn by
 * turn, and what must end up on the show once every card Roadie offered has been answered Yes. docs/post-show-chats.md
 * has the same conversations in prose, with the results of running them.
 *
 * Every conversation gets its own throwaway band (a "world"), so one's income never shows up in another's totals:
 *   speaker  Eval admin (an admin)
 *   band     only in the "payouts" world: Theo Park (drums, has a sign-in), Wren Whitlock (bass, no sign-in). Desmond, the
 *            sub, is not in the band. Musicians aren't partitioned by band yet (records.list shows every band's), so
 *            seeding the same two names in every world made Roadie ask "which Wren?"; one world has them, once.
 *   venues   The Red Barn (Fort Collins), Pine Hollow (Denver), Odell Brewing (Fort Collins)
 *   shows    by world: see seedWorld. "tonight" is context.now's tonight (yesterday's date before 6am).
 *
 * After each turn the harness taps Yes on every card from that turn (`yes: false` leaves them), the way she would with
 * the phone in her other hand, and the turn is saved to the thread exactly as the app saves it, so the next turn's
 * history is what production would send.
 */
import { importCtx, newRunId } from "../src/server/ctx";
import { db } from "../src/server/db";
import { registry } from "../src/server/commands/registry";
import { addDays } from "../src/lib/shows";
import { tonightDate } from "../src/server/assistant/context";

export type ShowKey = "tonight" | "afternoon" | "lastNight";
export type WorldKind = "one" | "two" | "lastNight" | "owedGuarantee" | "payouts";

/** A turn's checks, as in roadie-eval.ts, plus `noArgs` (no call to the first regex whose input matches the second) and `yes`. */
export interface PostShowTurn {
  say: string; calls?: RegExp[]; noCalls?: RegExp[]; cards?: number; text?: RegExp; noText?: RegExp; noAsk?: boolean;
  args?: [RegExp, RegExp][]; noArgs?: [RegExp, RegExp][];
  /** Tap Yes on this turn's cards before the next turn. Default true. */
  yes?: boolean;
}
/** Dollars, not cents. `method`: a payment method, or "none" for a line that must carry none; left out = any. */
export interface IncomeExpect { category: string; amount: number; method?: string; owed?: boolean; lines?: number }
export interface PayoutExpect { to: RegExp; amount: number; paid?: boolean; method?: string }
/** What must be on the show at the end. A number must match; null must be unset; left out is not checked. */
export interface Expect {
  show?: ShowKey;
  income: IncomeExpect[]; payouts?: PayoutExpect[];
  crowd?: number | null; paidAttendance?: number | null; showStars?: number | null; venueStars?: number | null;
  notes?: RegExp[]; noNotes?: RegExp[];
  /** Shows that must have no income, no payouts and no rating: the one she was NOT talking about. */
  untouched?: ShowKey[];
}
export interface PostShowScenario { name: string; world: WorldKind; page: "home" | "show" | "after"; turns: PostShowTurn[]; expect: Expect }

const MONEY = /income\.(add|update|setReceived)|payouts\.add/;
const WRITES = /income\.(add|update|setReceived|remove)|payouts\.|shows\.afterShow/;
/** A reply that asks something. */
const ASKS = /\?/;
const cents = (d: number) => new RegExp(`"amount":${Math.round(d * 100)}\\b`);

export const POST_SHOW: PostShowScenario[] = [
  // 1. Everything in one breath (the issue's own example, with the methods said).
  { name: "post-show-tidy-dump", world: "one", page: "home",
    turns: [{ say: "Tonight at the Red Barn: we made 340 at the door in cash, 120 cash merch, 60 merch on Venmo, about 45 people, show was great, sound guy was rough, 4 stars for the venue.", noText: /\b(can't|cannot)\b/i }],
    expect: { income: [{ category: "door", amount: 340, method: "cash" }, { category: "merch", amount: 120, method: "cash" }, { category: "merch", amount: 60, method: "venmo" }],
      crowd: 45, venueStars: 4, showStars: null, notes: [/sound/i] } },

  // 2. Counting out loud, a correction in the same breath, a correction after saving, then "what's the total?".
  { name: "post-show-counting-aloud", world: "one", page: "show",
    turns: [
      { say: "ok counting the tip jar. twenty, forty, sixty, eighty, a hundred, one twenty, and three fives so 135 in tips", args: [[/income\.add/, cents(135)]] },
      { say: "merch was 120 no wait 140, all cash", args: [[/income\.add/, cents(140)]], noArgs: [[/income\.add/, cents(120)]] },
      { say: "actually I missed a ten in the tip jar", calls: [/income\.(update|add)/] },
      { say: "what's the total so far?", text: /285/, noCalls: [WRITES] },
    ],
    expect: { income: [{ category: "tips", amount: 145, method: "cash" }, { category: "merch", amount: 140, method: "cash" }] } },

  // 3. One pile she can't split: ask, never invent a split; told "one lump", one line.
  { name: "post-show-one-pile", world: "one", page: "home",
    turns: [
      { say: "I've got 260 cash here from tonight but it's tips and merch all mixed together, no idea how much of each", noCalls: [MONEY], text: ASKS },
      { say: "can't tell, just put it down as one lump", calls: [/income\.add/], args: [[/income\.add/, cents(260)]] },
    ],
    expect: { income: [{ category: "other", amount: 260, method: "cash", lines: 1 }], notes: [] } },

  // 4. Venmo and cash mixed, several Venmos to add up. Then Roadie should ask about what she hasn't said (crowd, how it went).
  { name: "post-show-venmo-cash-mixed", world: "one", page: "after",
    turns: [{ say: "Merch: 85 cash and three Venmos, 25, 25 and 15. Tips were 62 in the jar plus a 20 on Venmo from some guy named Paul.", text: /crowd|how many|people|how'?d it go|rate|stars|rating/i }],
    expect: { income: [{ category: "merch", amount: 85, method: "cash" }, { category: "merch", amount: 65, method: "venmo" }, { category: "tips", amount: 62, method: "cash" }, { category: "tips", amount: 20, method: "venmo" }],
      crowd: null, showStars: null, venueStars: null } },

  // 5. Cash handed straight to the band and the sub: the door is the whole 400, the payouts are separate.
  { name: "post-show-paid-out-of-cash", world: "payouts", page: "home",
    turns: [{ say: "Door was 400 cash tonight. I gave Theo 100 and Wren 100 out of it and paid Desmond, the sub, 80. The rest is in the envelope.", noArgs: [[/income\.add/, cents(120)]] }],
    expect: { income: [{ category: "door", amount: 400, method: "cash" }],
      payouts: [{ to: /Theo/, amount: 100, paid: true }, { to: /Wren/, amount: 100, paid: true }, { to: /Desmond/, amount: 80, paid: true }] } },

  // 6. A bad night: almost nothing, and no $0 lines for what didn't sell.
  { name: "post-show-bad-night", world: "one", page: "home",
    turns: [{ say: "rough one tonight. nobody came, like 6 people. made 11 bucks cash in tips, no merch. sound was terrible, never playing here again. 1 star for the venue, the show was a 2", noArgs: [[/income\.add/, /"category":"merch"/]] }],
    expect: { income: [{ category: "tips", amount: 11, method: "cash" }], crowd: 6, venueStars: 1, showStars: 2, notes: [/sound/i, /never|again|not .*back/i] } },

  // 7. The guarantee was already entered as owed: paying it is setReceived, not a second guarantee. Plus a door split and the paid count.
  { name: "post-show-guarantee-plus-door", world: "owedGuarantee", page: "show",
    turns: [{ say: "They paid the 300 guarantee in cash, and on top of that he handed me 182 cash for our cut of the door. 96 paid at the door.", calls: [/income\.setReceived|income\.update/], noArgs: [[/income\.add/, /"category":"guarantee"/]] }],
    expect: { income: [{ category: "guarantee", amount: 300, method: "cash", lines: 1 }, { category: "door", amount: 182, method: "cash" }], paidAttendance: 96, crowd: null } },

  // 8. Two shows today: ask which one before entering anything.
  { name: "post-show-two-shows", world: "two", page: "home",
    turns: [
      { say: "we made 150 in tips and 80 in merch, all cash", noCalls: [WRITES], text: ASKS },
      { say: "the brewery one", calls: [/income\.add/] },
    ],
    expect: { show: "afternoon", income: [{ category: "tips", amount: 150, method: "cash" }, { category: "merch", amount: 80, method: "cash" }], untouched: ["tonight"] } },

  // 9. The next day: "last night" is yesterday's show, not the one on the calendar for tonight.
  { name: "post-show-last-night", world: "lastNight", page: "home",
    turns: [{ say: "forgot to do this after the show last night: 200 guarantee by check, 45 in cash tips, maybe 80 people, 5 star show" }],
    expect: { show: "lastNight", income: [{ category: "guarantee", amount: 200, method: "check" }, { category: "tips", amount: 45, method: "cash" }], crowd: 80, showStars: 5, venueStars: null, untouched: ["tonight"] } },

  // 10. Speech to text: "merge" is merch, "then mo" is Venmo, "the red born" is the Red Barn, "for stars" is 4. "to forty" is most likely 240:
  // Roadie may enter it or ask, but the reply has to say the number it took, so she hears it before she taps Yes.
  { name: "post-show-speech-to-text", world: "one", page: "home",
    turns: [
      { say: "ok so tonight at the red born the door was to forty cash and merge was 95 cash and then like 30 on then mo for merge crowd was maybe fifty five and yeah venue for stars",
        text: /240|\?/ },
      { say: "yes two hundred forty" },
    ],
    expect: { income: [{ category: "door", amount: 240, method: "cash" }, { category: "merch", amount: 95, method: "cash" }, { category: "merch", amount: 30, method: "venmo" }], crowd: 55, venueStars: 4 } },

  // 11. She only answers what she's asked: Roadie has to run the interview.
  { name: "post-show-interview", world: "one", page: "after",
    turns: [
      { say: "can we do the after show thing", noCalls: [WRITES], text: ASKS },
      { say: "just tips. 88", text: ASKS },
      { say: "cash. about 30 people" },
      { say: "3 stars for both" },
      { say: "no that's it" }, // the model may send the tips again; the server refuses a line this conversation already saved, so one line is what counts
    ],
    expect: { income: [{ category: "tips", amount: 88, method: "cash", lines: 1 }], crowd: 30, showStars: 3, venueStars: 3 } },

  // 11b. The day-of banner's "Record the deets" (DayOfBanner): one tap sends "Ask me about the <venue> show" from that show's page,
  // in a new chat. Two shows today, so only the page says which; Roadie has to start the interview, not ask which show.
  { name: "post-show-banner", world: "two", page: "show",
    turns: [
      { say: "Ask me about the Red Barn show", noCalls: [WRITES], text: ASKS, noText: /which show|Odell/i },
      { say: "door was 210 cash and merch was 45 on venmo" },
      { say: "about 50 people. 4 stars for the show, 5 for the venue" },
    ],
    expect: { income: [{ category: "door", amount: 210, method: "cash" }, { category: "merch", amount: 45, method: "venmo" }], crowd: 50, showStars: 4, venueStars: 5, untouched: ["afternoon"] } },

  // 12. She comes back: "another 20 on Venmo" adds to what's there, saying it twice doesn't add it twice, and a new note keeps the old one.
  { name: "post-show-comes-back", world: "one", page: "show",
    turns: [
      { say: "door was 220 cash, merch 60 on Venmo, 40 people, sound was great, 4 stars for the show and 4 for the venue" },
      { say: "another 20 on Venmo" },
      { say: "yeah that 20 was merch" },
      { say: "oh and Wren counted 52 paid at the door. add to the notes that Jess the promoter wants us back in the spring", calls: [/shows\.afterShow/] },
    ],
    expect: { income: [{ category: "door", amount: 220, method: "cash" }, { category: "merch", amount: 80, method: "venmo" }], crowd: 40, paidAttendance: 52, showStars: 4, venueStars: 4, notes: [/sound/i, /Jess/] } },

  // 13. Money that hasn't arrived: the guarantee is owed, the tips are in hand.
  { name: "post-show-check-in-the-mail", world: "one", page: "home",
    turns: [{ say: "The Red Barn is mailing the 500 guarantee as a check next week. Tips tonight were 73 cash." }],
    expect: { income: [{ category: "guarantee", amount: 500, owed: true }, { category: "tips", amount: 73, method: "cash" }] } },

  // 14. She gives the total and two parts; the rest is hers to define ("the rest must be tips"), so the sum is fine to do.
  { name: "post-show-the-rest-is-tips", world: "one", page: "home",
    turns: [{ say: "I counted 412 cash total tonight. Door was 300 and merch was 90, so the rest must be tips.", text: /22/ }],
    expect: { income: [{ category: "door", amount: 300, method: "cash" }, { category: "merch", amount: 90, method: "cash" }, { category: "tips", amount: 22, method: "cash" }] } },
];

// ---------- worlds ----------

type Call = (name: string, input: unknown) => Promise<{ id: string }>;
/** Seed one conversation's world into a fresh band. Returns the show ids by key. */
export async function seedWorld(kind: WorldKind, artistId: string, member: { uid: string }): Promise<Partial<Record<ShowKey, string>>> {
  const sys = importCtx("import", newRunId(), artistId);
  const call: Call = async (name, input) => (await registry[name].run(sys, registry[name].input.parse(input))) as { id: string };
  if (kind === "payouts") {
    await db.create(sys, "musicians", { name: "Theo Park", instruments: ["drums"], active: true, userId: member.uid });
    await db.create(sys, "musicians", { name: "Wren Whitlock", instruments: ["bass"], active: true });
  }
  await db.create(sys, "projects", { artistId, kind: "band", name: "Band", status: "open", isDefault: true });
  const venue = (name: string, city: string) => call("venues.create", { name, type: "bar", address: { city, state: "CO" }, region: city === "Denver" ? "denver" : "north" });
  // A guarantee on the deal becomes an income record that is owed until income.setReceived (shows.create does this).
  const show = (venueId: string, date: string, set: string, guarantee?: number) =>
    call("shows.create", { date, venueId, status: "confirmed", times: { loadIn: addHour(set, -2), set }, ...(guarantee ? { deal: { deal: "guarantee", guarantee } } : {}) });
  const tonight = tonightDate(new Date());
  const blue = await venue("The Red Barn", "Fort Collins");
  const shows: Partial<Record<ShowKey, string>> = { tonight: (await show(blue.id, tonight, "21:00", kind === "owedGuarantee" ? 30000 : undefined)).id };
  if (kind === "two") shows.afternoon = (await show((await venue("Odell Brewing", "Fort Collins")).id, tonight, "14:00")).id;
  if (kind === "lastNight") shows.lastNight = (await show((await venue("Pine Hollow", "Denver")).id, addDays(tonight, -1), "21:00")).id;
  return shows;
}
const addHour = (t: string, n: number) => `${String(Number(t.slice(0, 2)) + n).padStart(2, "0")}${t.slice(2)}`;

// ---------- what ended up recorded ----------

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const usd = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

/** Everything recorded for the band: income and payouts (live ones), and each show's deal. */
export async function recorded(artistId: string, shows: Partial<Record<ShowKey, string>>) {
  const live = (rows: Row[]) => rows.filter((r) => r.artistId === artistId && !r.deletedAt);
  const income = live(await db.list("income", (q) => q.where("artistId", "==", artistId)));
  const payouts = live(await db.list("payouts", (q) => q.where("artistId", "==", artistId)));
  const deals: Partial<Record<ShowKey, Row>> = {};
  for (const [k, id] of Object.entries(shows)) deals[k as ShowKey] = ((await db.get("showDeals", id!)) ?? {}) as Row;
  return { income, payouts, deals };
}

/** One line per record, for the log and the baseline. */
export function describe(rec: Awaited<ReturnType<typeof recorded>>, shows: Partial<Record<ShowKey, string>>): string[] {
  const key = (id?: string) => (Object.entries(shows).find(([, v]) => v === id)?.[0] ?? (id ? "another show" : "no show"));
  const out = [
    ...rec.income.map((x) => `income ${x.category} ${usd(x.amount)} ${x.method ?? "no method"} ${x.receivedAt ? "received" : "OWED"} (${key(x.showId)})${x.notes ? ` "${x.notes}"` : ""}`),
    ...rec.payouts.map((x) => `payout ${x.to?.name} ${usd(x.amount)} ${x.kind} ${x.method ?? "no method"} ${x.paidAt ? "paid" : "OWED"} (${key(x.showId)})`),
  ];
  for (const [k, d] of Object.entries(rec.deals)) {
    const r = (d?.rating ?? {}) as Row;
    out.push(`${k}: crowd ${d?.crowd ?? "-"}, paid ${d?.paidAttendance ?? "-"}, show ${r.show ?? "-"}/5, venue ${r.venue ?? "-"}/5, notes ${r.notes ? JSON.stringify(r.notes) : "-"}`);
  }
  return out.length ? out : ["nothing recorded"];
}

/** The ways what's recorded differs from what the conversation should have left. Empty = right. */
export function checkRecorded(e: Expect, rec: Awaited<ReturnType<typeof recorded>>, shows: Partial<Record<ShowKey, string>>): string[] {
  const fails: string[] = [];
  const showId = shows[e.show ?? "tonight"];
  const sum = (rows: Row[]) => rows.reduce((n, x) => n + (x.amount as number), 0);
  for (const x of e.income) {
    const rows = rec.income.filter((r) => r.category === x.category && !r.receivedAt === !!x.owed && (x.method === undefined || (x.method === "none" ? !r.method : r.method === x.method)));
    const want = `${x.category} ${usd(x.amount * 100)}${x.method ? ` ${x.method}` : ""}${x.owed ? " owed" : ""}`;
    if (sum(rows) !== x.amount * 100) fails.push(`income: expected ${want}, recorded ${rows.length ? usd(sum(rows)) : "none"}`);
    else if (x.lines !== undefined && rows.length !== x.lines) fails.push(`income: ${want} should be ${x.lines} line(s), is ${rows.length}`);
  }
  const total = e.income.reduce((n, x) => n + x.amount * 100, 0);
  if (sum(rec.income) !== total) fails.push(`income: ${usd(sum(rec.income))} recorded in all, expected ${usd(total)}`);
  for (const r of [...rec.income, ...rec.payouts]) if (r.showId !== showId) fails.push(`${r.category ?? `payout to ${r.to?.name}`} ${usd(r.amount)} is on ${r.showId ? "the wrong show" : "no show"}`);
  const pay = e.payouts ?? [];
  for (const p of pay) {
    const rows = rec.payouts.filter((r) => p.to.test(String(r.to?.name ?? "")));
    if (sum(rows) !== p.amount * 100) fails.push(`payout: expected ${usd(p.amount * 100)} to ${p.to.source}, recorded ${rows.length ? usd(sum(rows)) : "none"}`);
    else if (p.paid !== undefined && rows.some((r) => !!r.paidAt !== p.paid)) fails.push(`payout to ${p.to.source} should be ${p.paid ? "paid" : "owed"}`);
    else if (p.method && rows.some((r) => r.method !== p.method)) fails.push(`payout to ${p.to.source} should be ${p.method}`);
  }
  if (rec.payouts.length !== pay.length) fails.push(`payouts: ${rec.payouts.length} recorded, expected ${pay.length}`);
  const deal = rec.deals[e.show ?? "tonight"] ?? {}, rating = (deal.rating ?? {}) as Row;
  const same = (label: string, want: number | null | undefined, got: unknown) => {
    if (want === undefined) return;
    if (want === null ? got !== undefined && got !== null : got !== want) fails.push(`${label}: expected ${want ?? "nothing"}, recorded ${got ?? "nothing"}`);
  };
  same("crowd", e.crowd, deal.crowd);
  same("paid attendance", e.paidAttendance, deal.paidAttendance);
  same("show stars", e.showStars, rating.show);
  same("venue stars", e.venueStars, rating.venue);
  for (const re of e.notes ?? []) if (!re.test(String(rating.notes ?? ""))) fails.push(`notes: expected ${re}, recorded ${rating.notes ? JSON.stringify(rating.notes) : "none"}`);
  for (const re of e.noNotes ?? []) if (re.test(String(rating.notes ?? ""))) fails.push(`notes: should not match ${re}`);
  for (const k of e.untouched ?? []) {
    const d = rec.deals[k] ?? {};
    if (d.rating || d.crowd !== undefined || d.paidAttendance !== undefined) fails.push(`the ${k} show was rated, and she wasn't talking about it`);
  }
  return fails;
}
