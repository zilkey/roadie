/**
 * Shared plumbing for the real Google clients (gmail.ts, drive.ts, calendar.ts). A client is real when GOOGLE_OAUTH_CLIENT_ID
 * is set and its <SVC>_BASE_URL isn't (dev and tests set the base URLs, so they keep the fakes).
 */
import { IntegrationError, jsonClient } from "./http";

/** Gets an access token; `force` asks for a new one (after a 401). */
export type TokenSource = (force?: boolean) => Promise<string>;

export const useRealGoogle = (baseUrlEnv: string | undefined, baseUrlArg?: string) =>
  !!process.env.GOOGLE_OAUTH_CLIENT_ID && !baseUrlEnv && !baseUrlArg;

/** jsonClient with a Bearer token, retried once with a fresh token on 401. */
export function googleJson(service: string, baseUrl: string, token: TokenSource) {
  return async function call<T>(method: string, path: string, opts: { query?: Record<string, string | undefined>; body?: unknown } = {}): Promise<T> {
    const once = async (force: boolean) => jsonClient(service, baseUrl, { authorization: `Bearer ${await token(force)}` })<T>(method, path, opts);
    try {
      return await once(false);
    } catch (e) {
      if (e instanceof IntegrationError && e.status === 401) return once(true);
      throw e;
    }
  };
}
