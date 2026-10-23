/** Is this request addressed to the developer's own machine? Used to show dev-only help (never on the hosted app). */

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);

/** Hostname of a Host header value: drops the port and IPv6 brackets ("[::1]:3100" -> "::1", "127.0.0.1:3100" -> "127.0.0.1"). */
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]") > 0 ? h.indexOf("]") : undefined);
  if (h.split(":").length > 2) return h; // bare IPv6, no port
  return h.split(":")[0];
}

export const isLocalHostname = (host: string | null | undefined) => !!host && LOCAL.has(hostnameOf(host));

/**
 * True only when every host the request names is local: the Host header and, if a proxy set one, the first
 * X-Forwarded-Host. A request with no Host header is not local.
 */
export function isLocalRequest(h: Pick<Headers, "get">): boolean {
  const host = h.get("host");
  const forwarded = h.get("x-forwarded-host")?.split(",")[0];
  return isLocalHostname(host) && (forwarded == null || isLocalHostname(forwarded));
}
