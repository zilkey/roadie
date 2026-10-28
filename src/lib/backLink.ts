/**
 * Can "Back" go to a page of this app? `entries` are the URLs in the browser's history (the Navigation API; absent in
 * older browsers), `index` the current one, `historyLength` window.history.length. A shared link opened in a fresh tab
 * has no earlier entry; one reached from another site has an earlier entry on a different origin. Both use the page's
 * fixed parent instead.
 */
export function canGoBackInApp(origin: string, nav: { entries: string[]; index: number } | null, historyLength: number): boolean {
  if (!nav) return historyLength > 1;
  const prev = nav.entries[nav.index - 1];
  if (!prev) return false;
  try { return new URL(prev).origin === origin; } catch { return false; }
}
