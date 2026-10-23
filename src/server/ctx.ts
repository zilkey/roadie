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
}
export const newRunId = () => randomUUID();
export const importCtx = (uid = "import", runId: string = newRunId()): Ctx => ({ uid, role: "admin", via: "import", runId });
