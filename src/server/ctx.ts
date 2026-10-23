import { randomUUID } from "node:crypto";
import type { Via } from "@/schema/common";

export type Role = "admin" | "member" | "mcp";
export interface Ctx {
  uid: string;
  /** The caller's role in `artistId`. MCP sessions use "mcp". */
  role: Role;
  /**
   * The artist this call is for (the app sends it with every request; see `authenticate`). Absent for imports, scripts and
   * tests that build a Ctx by hand: commands then fall back to the one artist there is.
   */
  artistId?: string;
  musicianId?: string;
  via: Via;
  runId: string;
  /** Injectable clock (tests). Defaults to the real time. */
  now?: Date;
  /** Set by dispatch for autosave patches from the app: lets Writer.update fold them into the previous history entry. */
  autosave?: boolean;
  /** Set by dispatch: the `rev` the caller last saw of document `id`. Writer.update refuses to overwrite fields changed since. */
  baseRev?: { id: string; rev: number };
  /** Which assistant session made the call (Roadie: the thread id). The history entry records it. */
  sessionId?: string;
  /** Which assistant made the call, and the model if known (Roadie: {name: "Roadie", model}). */
  client?: { name: string; model?: string };
  /** Filled by Writer: doc id -> rev after this call's writes. Dispatch returns it so clients can track revs. */
  touched?: Record<string, number>;
}
export const newRunId = () => randomUUID();
export const importCtx = (uid = "import", runId: string = newRunId(), artistId?: string): Ctx => ({ uid, role: "admin", via: "import", runId, ...(artistId ? { artistId } : {}) });
