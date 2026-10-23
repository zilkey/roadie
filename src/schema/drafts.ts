import { z } from "zod";

/**
 * Unsubmitted drafts are not business data: top-level `unsubmittedDrafts/{uid}__{path with / as ~}`, written with
 * firebase-admin directly (never through db.ts, so no history), last write wins. The PATH is where the thing lives in Firestore:
 *   new record            -> its collection        "expenses"
 *   new record in a parent -> the parent's path     "venues/{id}/contacts"
 *   edits to a record      -> its document path     "shows/{id}"
 * (When multi-band lands these become "artists/{a}/...".)
 */
export const DRAFT_TTL_DAYS = 30;
export const DRAFT_TTL_MS = DRAFT_TTL_DAYS * 86_400_000;
export const DRAFT_MAX_BYTES = 100_000;

const COLL = "[A-Za-z][A-Za-z0-9]{0,40}", ID = "[A-Za-z0-9_-]{1,100}";
export const DRAFT_PATH = new RegExp(`^${COLL}(/${ID}(/${COLL})?)?$`);
export const DraftPath = z.string().max(250).regex(DRAFT_PATH, "Not a valid draft path");

export const draftPath = {
  /** A new record: its collection. */
  newIn: (collection: string) => collection,
  /** A new record that belongs to a parent: the parent's path plus the child collection. */
  newUnder: (parentCollection: string, parentId: string, child: string) => `${parentCollection}/${parentId}/${child}`,
  /** Unsaved edits to an existing record: its document path. */
  edit: (collection: string, id: string) => `${collection}/${id}`,
};
/** An existing record's path has an id as its last segment; a new-record path ends in a collection name (1 or 3 segments). */
export const isEditPath = (path: string) => path.split("/").length === 2;

/** `/` -> `~` (never part of a segment), so the id is reversible. */
export const draftDocId = (uid: string, path: string) => `${uid}__${path.replace(/\//g, "~")}`;
export const pathOfDocId = (id: string) => id.slice(id.indexOf("__") + 2).replace(/~/g, "/");

export const DraftSaveInput = z.strictObject({
  path: DraftPath,
  values: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= DRAFT_MAX_BYTES, "Draft is too large"),
  route: z.string().startsWith("/").max(500),
  title: z.string().max(200).default(""),
  /** Edits only: the rev of the record the edits were made against (becomes `baseRev` when they are replayed). */
  rev: z.number().int().min(0).optional(),
});
export type DraftSaveInput = z.infer<typeof DraftSaveInput>;

/** As stored (times are Firestore Timestamps). */
export interface DraftDoc {
  uid: string; path: string; values: Record<string, unknown>; route: string; title: string; rev?: number;
  updatedAt: { toMillis(): number }; expiresAt: { toMillis(): number };
}
