/**
 * Bandsintown integration. Real implementation later: Bandsintown for Artists / partner API
 * (needs an approved app_id and artist access; see docs/FIREBASE-SETUP.md). The public API is read-only.
 */
import { jsonClient } from "./http";

export interface BitEvent {
  id: string; artist: string; datetime: string; venueName: string; city: string; region?: string; country?: string;
  description?: string; ticketUrl?: string; timeZone?: string; status: "active"; createdAt: string; updatedAt: string;
}
export interface BitEventInput { datetime: string; venueName: string; city: string; region?: string; country?: string; description?: string; ticketUrl?: string; timeZone?: string }

export interface BandsintownService {
  create(input: BitEventInput): Promise<BitEvent>;
  update(id: string, patch: Partial<BitEventInput>): Promise<BitEvent>;
  delete(id: string): Promise<void>;
  list(): Promise<BitEvent[]>;
}

export function bandsintownClient(baseUrl = process.env.BANDSINTOWN_BASE_URL ?? "http://127.0.0.1:3204"): BandsintownService {
  const call = jsonClient("bandsintown", baseUrl);
  const e = (id: string) => `/events/${encodeURIComponent(id)}`;
  return {
    create: (input) => call("POST", "/events", { body: input }),
    update: (id, patch) => call("PATCH", e(id), { body: patch }),
    delete: async (id) => { await call("DELETE", e(id)); },
    list: () => call("GET", "/events"),
  };
}
