/** The MCP server proper: every registry command whose roles include "mcp" is a tool. Transport-agnostic. */
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registry } from "@/server/commands/registry";
import type { Command } from "@/server/commands/types";
import type { Ctx } from "@/server/ctx";
import { AppError, invalid } from "@/server/errors";

export const mcpCommands = (): Command[] => Object.values(registry).filter((c) => c.roles.includes("mcp"));

export function toolList() {
  return mcpCommands().map((c) => ({
    name: c.name,
    description: c.description,
    inputSchema: toJsonSchema(c.input),
  }));
}

export function toJsonSchema(schema: z.ZodType): { type: "object"; [k: string]: unknown } {
  const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return { type: "object", ...js } as { type: "object" };
}

/** Firestore Timestamps and Dates become ISO strings so the AI can read them. */
export function jsonSafe(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Date) return v.toISOString();
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === "function") return t.toDate().toISOString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
}

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (v: unknown, isError = false): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(jsonSafe(v), null, 2) }], ...(isError ? { isError: true } : {}) });

/** Run a tool. Errors (including Zod validation) come back as structured tool errors, never as protocol errors. */
export async function callTool(name: string, args: unknown, authorize: () => Promise<Ctx>): Promise<ToolResult> {
  try {
    const ctx = await authorize();
    const cmd = registry[name];
    if (!cmd || !cmd.roles.includes("mcp")) throw new AppError("unknown_tool", `No tool named ${name}`, 404);
    const parsed = cmd.input.safeParse(args ?? {});
    if (!parsed.success) throw invalid(parsed.error);
    const result = await cmd.run(ctx, parsed.data);
    return text({ result: result ?? null, runId: ctx.runId });
  } catch (e) {
    if (e instanceof AppError) return text(e.toJSON(), true);
    console.error(e);
    return text({ error: { code: "internal", message: "Something went wrong" } }, true);
  }
}

/** One MCP server per session. `authorize` re-checks the token on every call, so a revoked key stops working at once. */
export function createMcpServer(authorize: () => Promise<Ctx>) {
  const server = new Server({ name: "band-tracker", version: "0.1.0" }, {
    capabilities: { tools: {} },
    instructions:
      "Band Tracker for the Ingrid Avison Band. Search before you create (venues, promoters, festivals and contacts dedupe by name and merge). " +
      "A venue's name, address and house facts are one shared record that every band using Band Tracker sees: editing them changes the room for all of them. " +
      "A venue's loadInNotes, notes, contacts and promoters are this band's private notes. Fix a duplicate venue with venues.mergeInto. " +
      "Money is integer cents. Dates are YYYY-MM-DD. You can draft emails (pitches.draftEmail) but never send them. " +
      "Input errors come back as {error:{code:'invalid_input', issues:[{path,message}]}}: fix the fields and retry. " +
      "Everything you change in this session shares one runId and can be undone with history.undoRun.",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments, authorize));
  return server;
}
