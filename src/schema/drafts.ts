import { z } from "zod";

/** Drafts are not business data: they live at users/{uid}/drafts/{draftId}, are written with firebase-admin directly and never touch history. */
export const DRAFT_TTL_DAYS = 30;
export const DRAFT_TTL_MS = DRAFT_TTL_DAYS * 86_400_000;

/** One draft per (kind, contextKey): "show" + "new", or "show" + "pitch:abc" when started from a pitch. */
export const draftId = (kind: string, contextKey: string) => `${kind}__${contextKey}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 150);

const MAX_BYTES = 100_000;
export const DraftSaveInput = z.strictObject({
  kind: z.string().regex(/^[a-z][A-Za-z0-9]{0,40}$/),
  contextKey: z.string().min(1).max(200).default("new"),
  values: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= MAX_BYTES, "Draft is too large"),
  route: z.string().startsWith("/").max(500),
  title: z.string().max(200).default(""),
});
export type DraftSaveInput = z.infer<typeof DraftSaveInput>;

/** As stored (times are Firestore Timestamps). */
export interface DraftDoc {
  kind: string; contextKey: string; values: Record<string, unknown>; route: string; title: string;
  createdAt: { toMillis(): number }; updatedAt: { toMillis(): number };
}
