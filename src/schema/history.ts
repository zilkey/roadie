import { z } from "zod";
import { entity, serverMask } from "./common";

export const History = entity({
  entity: z.strictObject({ kind: z.string(), id: z.string() }),
  op: z.enum(["create", "update", "delete", "merge", "restore"]),
  /** field -> {before, after}. (Blueprint says [before, after]; Firestore forbids nested arrays.) */
  diff: z.record(z.string(), z.strictObject({ before: z.unknown(), after: z.unknown() })),
  /** Order of this change inside one transaction (undo replays a run newest-first). */
  seq: z.number().int().optional(),
  /** The document's `rev` after this change (a folded autosave entry keeps the latest). Used for conflict checks and coalescing. */
  docRev: z.number().int().optional(),
  /** Written by an autosave patch from the app: later autosave patches by the same person may fold into it. */
  autosave: z.boolean().optional(),
  actor: z.strictObject({ uid: z.string(), via: z.enum(["app", "mcp", "import"]) }),
});
export const HistoryInput = History.omit(serverMask);
export type History = z.infer<typeof History>;
