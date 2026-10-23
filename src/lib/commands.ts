import { clientAuth } from "./firebase-client";

export class CommandError extends Error {
  /** `data` carries structured detail, e.g. `{conflicts, currentRev}` on a 409 `conflict`. `status` 0 = the request never reached the server. */
  constructor(public code: string, message: string, public status: number, public issues?: { path: string; message: string }[], public data?: unknown) {
    super(message);
  }
}

/** Optional envelope sent next to a command's input (see `Meta` in src/server/commands/dispatch.ts). */
export interface CommandMeta { clientMutationId?: string; baseRev?: number; autosave?: boolean; clearDraft?: string }
export interface CommandOutcome<T> { result: T; runId: string; /** doc id -> rev after this call. */ revs: Record<string, number> }

export const newMutationId = () => crypto.randomUUID();

/** Like runCommand, but also returns the runId (for Undo) and the new revs. */
export async function runCommandFull<T = { id?: string }>(name: string, input: unknown = {}, meta?: CommandMeta): Promise<CommandOutcome<T>> {
  const user = clientAuth().currentUser;
  if (!user) throw new CommandError("unauthenticated", "Not signed in", 401);
  let res: Response;
  const body = JSON.stringify(meta && Object.keys(meta).length ? { ...(input as object), _meta: meta } : input);
  try {
    res = await fetch(`/api/commands/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await user.getIdToken()}` },
      body,
      keepalive: body.length < 60_000, // a request already on its way survives the tab closing (browsers cap keepalive bodies at 64KB)
    });
  } catch {
    throw new CommandError("offline", "You're offline", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    throw new CommandError(e.code ?? "error", e.message ?? res.statusText, res.status, e.issues, e.data);
  }
  return { result: json.result as T, runId: json.runId as string, revs: (json.revs ?? {}) as Record<string, number> };
}

/** Call a server command with the signed-in user's ID token. Throws CommandError. */
export async function runCommand<T = { id?: string }>(name: string, input: unknown = {}, meta?: CommandMeta): Promise<T> {
  return (await runCommandFull<T>(name, input, meta)).result;
}
