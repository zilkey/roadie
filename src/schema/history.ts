import { z } from "zod";
import { entity, serverMask } from "./common";

/** One changed field. A list whose items all carry a stable `id` is diffed by item id (only the items that changed). */
export const FieldDiff = z.union([
  z.strictObject({ before: z.unknown(), after: z.unknown() }),
  z.strictObject({
    /** itemId -> the item before/after (null = was not there / was removed). `at` = index in the old list, used to put a removed item back. */
    byId: z.record(z.string(), z.strictObject({ before: z.unknown(), after: z.unknown(), at: z.number().int().optional() })),
    /** Item ids in order before/after; only present when items were reordered. */
    order: z.strictObject({ before: z.array(z.string()), after: z.array(z.string()) }).optional(),
  }),
]);

/**
 * Lives at `{docPath}/history/{rev}` (rev zero-padded to 6 digits, so entries sort by id): a subcollection under the
 * record it describes, written in the same transaction as the change. `entity.kind` is the collection path.
 */
export const History = entity({
  entity: z.strictObject({ kind: z.string(), id: z.string() }),
  op: z.enum(["create", "update", "delete", "merge", "restore"]),
  /** Only the changed fields: field -> {before, after}, or {byId, order?} for id-keyed lists. (Blueprint says [before, after]; Firestore forbids nested arrays.) */
  diff: z.record(z.string(), FieldDiff),
  /** Order of this change inside one transaction (undo replays a run newest-first). */
  seq: z.number().int().optional(),
  /** The document's `rev` after this change (a folded autosave entry keeps the latest). Equals the entry's id. */
  docRev: z.number().int().optional(),
  /** Written by an autosave patch from the app: later autosave patches by the same person may fold into it. */
  autosave: z.boolean().optional(),
  actor: z.strictObject({
    uid: z.string(),
    via: z.enum(["app", "mcp", "import", "assistant"]),
    /** Roadie / MCP session this change came from, when there is one. */
    sessionId: z.string().optional(),
    /** The AI client (for example Claude Desktop) and model, when known. */
    client: z.strictObject({ name: z.string(), model: z.string().optional() }).optional(),
  }),
});
export const HistoryInput = History.omit(serverMask);
export type History = z.infer<typeof History>;
export type FieldDiff = z.infer<typeof FieldDiff>;
