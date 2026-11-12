/** Merch price list and cart helpers, shared by the public fan page and the Merch page. Pure: no I/O. */

export interface PriceLine { id: string; name: string; priceCents: number }
/** Item id -> how many. */
export type Cart = Record<string, number>;

/** "$5" for whole dollars, "$4.50" otherwise. */
export const money = (cents: number) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

/** What the cart costs, from the price list (an item no longer listed counts for nothing). */
export function cartTotal(items: readonly PriceLine[], cart: Cart): number {
  return items.reduce((n, i) => n + i.priceCents * (cart[i.id] ?? 0), 0);
}

/** The Venmo note: "2 Coozie, 1 T-Shirt", in price list order. Empty for an empty cart. */
export function cartNote(items: readonly PriceLine[], cart: Cart): string {
  return items.filter((i) => (cart[i.id] ?? 0) > 0).map((i) => `${cart[i.id]} ${i.name}`).join(", ");
}

/**
 * The link that opens Venmo to pay @handle. With an amount, Venmo opens with it and the note filled in
 * (venmo.com/{handle}?txn=pay&amount=&note=; on a phone the link opens the Venmo app). Without one, the profile page.
 */
export function venmoPayUrl(handle: string, cents = 0, note = ""): string {
  const base = `https://venmo.com/${encodeURIComponent(handle)}`;
  if (cents <= 0) return base;
  const q = new URLSearchParams({ txn: "pay", amount: (cents / 100).toFixed(2) });
  if (note) q.set("note", note);
  return `${base}?${q.toString().replace(/\+/g, "%20")}`;
}

/** Dollars typed in a price box ("5", "$4.50") as cents, or null when it isn't a price. */
export function parsePrice(text: string): number | null {
  const m = /^\$?\s*(\d{1,5})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

/** Black or white text on a "#rrggbb" color, whichever reads better. */
export function onColor(hex: string): "#000000" | "#ffffff" {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.179 ? "#000000" : "#ffffff";
}
