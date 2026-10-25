/**
 * How a Who's free post gets to Signal. Touch screens (phones, iPads) get the share sheet and pick Signal there. Everything else
 * copies the text and opens Signal Desktop on the group: Macs have navigator.share too, but the macOS share card doesn't list Signal.
 */
export function shareSheetFor(env: { canShare: boolean; coarsePointer: boolean }): boolean {
  return env.canShare && env.coarsePointer;
}

/** shareSheetFor, in this browser. */
export function shareSheetHere(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return shareSheetFor({ canShare: typeof navigator.share === "function", coarsePointer: !!window.matchMedia?.("(pointer: coarse)").matches });
}
