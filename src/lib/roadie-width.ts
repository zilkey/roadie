/** Roadie's desktop panel width: the narrow rail, or a width in pixels that the admin drags. */
export type PanelWidth = "narrow" | number;

/** The narrowest panel; drag below it and the panel snaps to the rail. */
export const MIN_PX = 280;
/** The width a new admin gets, and what the old `full` setting meant. */
export const DEFAULT_PX = 360;
/** The rail's width. */
export const RAIL_PX = 72;
/** One arrow-key press. */
export const STEP_PX = 16;

/** The widest the panel may be in a window this wide: half of it, never under the minimum. */
export const maxPx = (windowW: number) => Math.max(MIN_PX, Math.floor(windowW / 2));

/** A pixel width kept between the minimum and half the window. */
export const clampPx = (px: number, windowW: number) => Math.min(maxPx(windowW), Math.max(MIN_PX, Math.round(px)));

/** Read a saved width (server or localStorage): the old `full`, a missing value or junk is the default size. */
export function fromSaved(v: unknown): PanelWidth {
  if (v === "narrow") return "narrow";
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= MIN_PX ? Math.round(n) : DEFAULT_PX;
}

/** Where a drag lands: below the minimum snaps to the rail, otherwise clamped to the window. */
export const dragTo = (px: number, windowW: number): PanelWidth => (px < MIN_PX ? "narrow" : clampPx(px, windowW));

/** What an arrow key does with the handle on the panel's left edge: left widens, right narrows. Home/End go to the ends. */
export function keyTo(key: string, px: number, windowW: number): number | null {
  switch (key) {
    case "ArrowLeft": return clampPx(px + STEP_PX, windowW);
    case "ArrowRight": return clampPx(px - STEP_PX, windowW);
    case "Home": return MIN_PX;
    case "End": return maxPx(windowW);
    default: return null;
  }
}
