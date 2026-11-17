/**
 * In-app navigation stack, kept in memory (a full page load starts it empty, so a shared link or a reload has no "back" and the
 * back link falls back to its fixed parent). Shell feeds it each pathname; stepping onto the previous entry counts as going back.
 */
let stack: string[] = [];

/** The stack after landing on `path`: unchanged for the same page, popped when it is the page before, else pushed. */
export function nextStack(s: string[], path: string): string[] {
  if (s[s.length - 1] === path) return s;
  if (s.length >= 2 && s[s.length - 2] === path) return s.slice(0, -1);
  return [...s, path].slice(-50);
}

/** True when there is an earlier in-app page to go back to. */
export function canGoBack(s: string[]): boolean {
  return s.length >= 2;
}

/**
 * The page a back or forward step (the Back link's router.back, or the browser's) landed on, until that page takes it. It is
 * kept by path, not cleared when the Shell records the new path: the page can mount a commit or more after that (its code
 * still loading, a loading screen first), and it must still know it was stepped back to. Going anywhere else drops it.
 */
let popped: string | null = null;
// Where it is told matters: Chrome draws the page it steps to before `popstate` fires (Next renders it from its own
// history state), so a list mounting then wouldn't know. The Navigation API's `navigate` event (type "traverse") comes
// first; `popstate` is the fallback for browsers without it, in the capture phase so it runs before Next's own listener.
if (typeof window !== "undefined") {
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener("navigate", (e) => {
    const ev = e as Event & { navigationType?: string; destination?: { url: string } };
    if (ev.navigationType === "traverse" && ev.destination) popped = new URL(ev.destination.url).pathname;
  });
  window.addEventListener("popstate", () => { popped = window.location.pathname; }, { capture: true });
}
/**
 * Whether the page on screen was reached by a back or forward step. Reading it doesn't clear it: the first instance to
 * read it may be thrown away (a loading screen, a remount) before it does anything, and the one that stays must still
 * see it. The page clears it with `steppedBackDone` once it has put itself back.
 */
export function steppedBack(): boolean {
  return popped !== null && popped === window.location.pathname;
}
export function steppedBackDone() { popped = null; }

/** Create forms (".../new") are never a place to go back to: they leave by router.replace, so they are not recorded. */
export function recordPath(path: string) {
  if (popped !== null && popped !== path) popped = null;
  if (!path.endsWith("/new")) stack = nextStack(stack, path);
  listeners.forEach((l) => l());
}
const listeners = new Set<() => void>();
/** For useSyncExternalStore: called after each recorded path, so a page can show where it was reached from (the Booking breadcrumbs). */
export function subscribeNav(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
/** The page before this one, if the person came from elsewhere in the app. */
export function previousPath(): string | undefined { return canGoBack(stack) ? stack[stack.length - 2] : undefined; }
