/** Minimal JSON-over-HTTP helper shared by the fake-backed clients. */
export class IntegrationError extends Error {
  constructor(public service: string, public status: number, message: string) { super(`${service}: ${message} (HTTP ${status})`); }
}

export function jsonClient(service: string, baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return async function call<T>(method: string, path: string, opts: { query?: Record<string, string | undefined>; body?: unknown } = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined) as [string, string][]).toString();
    const res = await fetch(`${base}${path}${qs ? `?${qs}` : ""}`, {
      method, headers: opts.body ? { "content-type": "application/json" } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new IntegrationError(service, res.status, data?.error?.message ?? res.statusText);
    return data as T;
  };
}
