import { z } from "zod";
import { entity, serverMask } from "./common";

export const History = entity({
  entity: z.strictObject({ kind: z.string(), id: z.string() }),
  op: z.enum(["create", "update", "delete", "merge", "restore"]),
  /** field -> {before, after}. (Blueprint says [before, after]; Firestore forbids nested arrays.) */
  diff: z.record(z.string(), z.strictObject({ before: z.unknown(), after: z.unknown() })),
  actor: z.strictObject({ uid: z.string(), via: z.enum(["app", "mcp", "import"]) }),
});
export const HistoryInput = History.omit(serverMask);
export type History = z.infer<typeof History>;
