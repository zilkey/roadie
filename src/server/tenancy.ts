/**
 * Multi-tenancy plan, phase 2: every new record carries its artist. Stamping never refuses a write in this phase; when no artist
 * can be found the write goes ahead and this logs `{event: "tenancy.unstamped", kind, id, via}` (Cloud Logging's jsonPayload),
 * so the entry point can be fixed before phase 4 makes the server refuse.
 *
 *   gcloud logging read 'jsonPayload.event="tenancy.unstamped"' --project roadie-prod-iab --freshness=1d
 */
export interface Unstamped { kind: string; id: string; via: string; uid?: string }

export const tenancyLog = {
  /** Replaceable in tests. */
  unstamped(e: Unstamped) {
    console.warn(JSON.stringify({ severity: "WARNING", event: "tenancy.unstamped", ...e, message: `tenancy.unstamped ${e.kind}/${e.id} (${e.via})` }));
  },
};
