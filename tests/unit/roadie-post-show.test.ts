import { test } from "node:test";
import assert from "node:assert/strict";
import { heard, showOf, ASK_CROWD, ASK_STARS, TAP_EACH } from "@/server/assistant/postShow";

const income = (category: string, amount: number, method?: string, owed = false) =>
  ({ command: "income.add", input: { category, amount, showId: "s1", ...(method ? { method } : {}), ...(owed ? {} : { receivedAt: "2026-11-10" }) } });

test("heard: every amount and the total, from the cards' own inputs", () => {
  assert.equal(heard([income("door", 30000, "cash"), income("merch", 9000, "cash"), income("tips", 2200, "cash")]),
    `Here's what I heard: door $300 cash, merch $90 cash, tips $22 cash. That's $412 in. ${TAP_EACH}`);
});

test("heard: owed money, a guarantee marked received and payouts are counted apart", () => {
  const s = heard([
    income("guarantee", 50000, "check", true), income("tips", 7350, "venmo"),
    { command: "income.setReceived", input: { id: "i1", method: "cash" }, amount: 30000, from: "The Red Barn" },
    { command: "payouts.add", input: { to: { musicianId: "m1" }, amount: 10000, paidAt: "2026-11-10" }, person: "Felix Brandt" },
    { command: "payouts.add", input: { to: { name: "Desmond" }, amount: 8000, paidAt: "2026-11-10" } },
  ])!;
  assert.match(s, /guarantee \$500 still owed, tips \$73\.50 Venmo, The Red Barn's \$300 received cash, paid Felix Brandt \$100, Desmond \$80\./);
  assert.match(s, /That's \$373\.50 in, \$500 still owed to us, \$180 to the band\./);
});

test("heard: one card says it all itself; other cards don't count", () => {
  assert.equal(heard([income("tips", 8800, "cash")]), undefined);
  assert.equal(heard([income("tips", 8800, "cash"), { command: "shows.update", input: { id: "s1", patch: { status: "played" } } }]), undefined);
});

test("showOf: the one show the money is for", () => {
  assert.equal(showOf([income("tips", 100), income("door", 100)]), "s1");
  assert.equal(showOf([income("tips", 100), { command: "income.add", input: { category: "door", amount: 1, showId: "s2" } }]), undefined);
  assert.equal(showOf([{ command: "income.add", input: { category: "other", amount: 1 } }]), undefined);
});
