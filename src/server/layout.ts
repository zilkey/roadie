/**
 * Where artist data lives, and whether Roadie is taking writes (tenancy phase 10). Both come from `platform/config`:
 * - `nestedPaths` (on unless set to false): artist records live under their artist (`artists/{id}/shows/{showId}`), not top level. Since
 *   the old top-level copies and their rules were deleted (2026-11-26) the browser can only read the nested layout. Every path is built by
 *   `pathOf` / `physicalPath` (src/schema/owners.ts), which read the flag this sets. The browser gets it with the session.
 * - `readOnly: true`: the short window while scripts/migrate-nested.ts copies the data. Every write is refused with READ_ONLY_MESSAGE
 *   (the Writer checks before it commits) and the app shows a banner.
 * Read at most every few seconds per server instance. `ROADIE_NESTED_PATHS=1|0` and `ROADIE_READ_ONLY=1|0` override the doc (tests).
 */
import { firestore } from "./admin";
import { AppError } from "./errors";
import { setNestedPaths } from "@/schema/owners";

export interface Layout { nestedPaths: boolean; readOnly: boolean }
export const READ_ONLY_MESSAGE = "Roadie is moving your data. Try again in a few minutes.";
const TTL_MS = 5_000;
let cached: { at: number; layout: Layout } | null = null;

const envFlag = (name: string) => (process.env[name] === "1" ? true : process.env[name] === "0" ? false : undefined);

/** The current layout (and sets the path helpers' flag to match). */
export async function layout(): Promise<Layout> {
  const now = Date.now();
  if (!cached || now - cached.at > TTL_MS) {
    const envNested = envFlag("ROADIE_NESTED_PATHS"), envRo = envFlag("ROADIE_READ_ONLY");
    const d = envNested !== undefined && envRo !== undefined ? {} : (await firestore().doc("platform/config").get()).data() ?? {};
    cached = { at: now, layout: { nestedPaths: envNested ?? d.nestedPaths !== false, readOnly: envRo ?? d.readOnly === true } };
  }
  setNestedPaths(cached.layout.nestedPaths);
  return cached.layout;
}
/** Read platform/config again on the next call (tests, and scripts that just flipped it). */
export function forgetLayout() { cached = null; }

export const readOnlyError = () => new AppError("read_only", READ_ONLY_MESSAGE, 503);
/** Refuse a write while Roadie is read-only (writes outside the Writer: Roadie's transcripts, a fan's hard delete). */
export async function assertWritable() { if ((await layout()).readOnly) throw readOnlyError(); }
