import { randomUUID } from "node:crypto";
import type { Via } from "@/schema/common";

export type Role = "admin" | "member" | "mcp";
export interface Ctx {
  uid: string;
  /** The caller's role. MCP sessions use "mcp". */
  role: Role;
  musicianId?: string;
  via: Via;
  runId: string;
  /** Injectable clock (tests). Defaults to the real time. */
  now?: Date;
  /** Set by dispatch for autosave patches from the app: lets Writer.update fold them into the previous history entry. */
  autosave?: boolean;
  /** Set by dispatch: the `rev` the caller last saw of document `id`. Writer.update refuses to overwrite fields changed since. */
  baseRev?: { id: string; rev: number };
  /** Filled by Writer: doc id -> rev after this call's writes. Dispatch returns it so clients can track revs. */
  touched?: Record<string, number>;
}
export const newRunId = () => randomUUID();
export const importCtx = (uid = "import", runId: string = newRunId()): Ctx => ({ uid, role: "admin", via: "import", runId });
