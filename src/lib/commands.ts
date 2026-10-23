import { clientAuth } from "./firebase-client";

export class CommandError extends Error {
  constructor(public code: string, message: string, public status: number, public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

/** Call a server command with the signed-in user's ID token. Throws CommandError. */
export async function runCommand<T = { id?: string }>(name: string, input: unknown = {}): Promise<T> {
  const user = clientAuth().currentUser;
  if (!user) throw new CommandError("unauthenticated", "Not signed in", 401);
  const res = await fetch(`/api/commands/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    throw new CommandError(e.code ?? "error", e.message ?? res.statusText, res.status, e.issues);
  }
  return json.result as T;
}
