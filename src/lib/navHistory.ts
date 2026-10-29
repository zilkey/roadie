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

/** Create forms (".../new") are never a place to go back to: they leave by router.replace, so they are not recorded. */
export function recordPath(path: string) { if (!path.endsWith("/new")) stack = nextStack(stack, path); }
/** The page before this one, if the person came from elsewhere in the app. */
export function previousPath(): string | undefined { return canGoBack(stack) ? stack[stack.length - 2] : undefined; }
