import { test } from "node:test";
import assert from "node:assert/strict";
import { cartNote, cartTotal, money, onColor, parsePrice, venmoPayUrl } from "@/lib/merch";

const ITEMS = [{ id: "cz", name: "Coozie", priceCents: 500 }, { id: "ts", name: "T-Shirt", priceCents: 2500 }, { id: "st", name: "Sticker", priceCents: 450 }];

test("money: whole dollars bare, cents with two places", () => {
  assert.equal(money(500), "$5");
  assert.equal(money(450), "$4.50");
  assert.equal(money(0), "$0");
});

test("cart: total and note in price list order; unlisted items count for nothing", () => {
  const cart = { ts: 1, cz: 2, gone: 3, st: 0 };
  assert.equal(cartTotal(ITEMS, cart), 3500);
  assert.equal(cartNote(ITEMS, cart), "2 Coozie, 1 T-Shirt");
  assert.equal(cartTotal(ITEMS, {}), 0);
  assert.equal(cartNote(ITEMS, {}), "");
});

test("venmoPayUrl: the profile with no amount; pay, amount and note otherwise, spaces as %20", () => {
  assert.equal(venmoPayUrl("Ingrid-Avison"), "https://venmo.com/Ingrid-Avison");
  assert.equal(venmoPayUrl("Ingrid-Avison", 0, "x"), "https://venmo.com/Ingrid-Avison");
  assert.equal(venmoPayUrl("Ingrid-Avison", 3500, "2 Coozie, 1 T-Shirt"), "https://venmo.com/Ingrid-Avison?txn=pay&amount=35.00&note=2%20Coozie%2C%201%20T-Shirt");
  assert.equal(venmoPayUrl("a", 450), "https://venmo.com/a?txn=pay&amount=4.50");
});

test("parsePrice: dollars with an optional $ and cents", () => {
  assert.equal(parsePrice("25"), 2500);
  assert.equal(parsePrice("$4.5"), 450);
  assert.equal(parsePrice(" 4.50 "), 450);
  assert.equal(parsePrice("0"), 0);
  for (const bad of ["", "abc", "4.", "4.555", "-1", "1,000"]) assert.equal(parsePrice(bad), null, bad);
});

test("onColor: black on light colors, white on dark ones", () => {
  assert.equal(onColor("#f0b400"), "#000000");
  assert.equal(onColor("#ffffff"), "#000000");
  assert.equal(onColor("#111111"), "#ffffff");
  assert.equal(onColor("#5561e8"), "#ffffff");
});
