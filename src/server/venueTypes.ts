import type { Writer } from "./db";
import { AppError } from "./errors";
import { BUILTIN_VENUE_TYPES } from "@/schema";

/** The list starts as the seven built-in types: written the first time anything touches it while it is still empty. */
export async function ensureVenueTypes(w: Writer) {
  if ((await w.query("venueTypes", (q) => q.limit(1), { includeDeleted: true })).length) return;
  for (const [id, label] of BUILTIN_VENUE_TYPES) await w.create("venueTypes", { label }, { id });
}

/** A venue's type must be on the list. `current` (the venue's own type, even one since taken off the list) is always kept. */
export async function requireVenueType(w: Writer, key: unknown, current?: unknown) {
  if (typeof key !== "string" || key === current) return;
  // Read only: while nobody has touched the list (still empty) the built-in keys are the list.
  const empty = !(await w.query("venueTypes", (q) => q.limit(1), { includeDeleted: true })).length;
  const t = empty ? null : await w.get("venueTypes", key);
  if (empty ? !BUILTIN_VENUE_TYPES.some(([k]) => k === key) : !t || t.deletedAt) throw new AppError("invalid_input", `"${key}" is not a venue type. Use a key from records.list venueTypes, or add one with venueTypes.add.`, 400);
}
