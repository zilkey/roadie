import { clientAuth } from "./firebase-client";
import { CommandError } from "./commands";

/**
 * artists.signUp: start your first band. Only needs to be signed in with Google (no membership yet), so it is a route of
 * its own rather than a command (see src/server/signUp.ts). Returns the new band's slug; callers then `refresh()` the auth
 * context so the session knows about it. Throws CommandError (a taken slug is a 409 with issues [{path: "slug"}]).
 */
export async function signUpBand(input: { name: string; slug?: string; instruments?: string[] }): Promise<{ slug: string }> {
  const user = clientAuth().currentUser;
  if (!user) throw new CommandError("unauthenticated", "Not signed in", 401);
  let res: Response;
  try {
    res = await fetch("/api/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new CommandError("offline", "You're offline", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    throw new CommandError(e.code ?? "error", e.message ?? res.statusText, res.status, e.issues);
  }
  return json as { slug: string };
}
