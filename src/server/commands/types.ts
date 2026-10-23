import type { z } from "zod";
import type { Ctx, Role } from "../ctx";

export interface Command<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Who may call it. "mcp" = the MCP server (slice 7). */
  roles: Role[];
  description: string;
  input: S;
  run(ctx: Ctx, input: z.infer<S>): Promise<unknown>;
}
export const defineCommand = <S extends z.ZodType>(c: Command<S>) => c;
