/** Money is integer cents everywhere. */
export const dollarsToCents = (d: number | string) => Math.round(Number(d) * 100);
export const centsToDollars = (c: number) => c / 100;
export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
