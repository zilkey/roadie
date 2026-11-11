/**
 * Maps lookups: address autocomplete, geocoding, reverse geocoding and driving directions. In production they go to Google Maps
 * Platform (google-maps.ts; secret GOOGLE_MAPS_API_KEY: Places API (New), Geocoding API, Routes API). Without that key this
 * OpenRouteService (Pelias) client answers; locally it talks to the fake at fakes/fake-ors (openrouteservice.org is shut down).
 */
import { jsonClient } from "./http";
import { googleMapsClient } from "./google-maps";

export interface OrsPlace {
  /** Venue/place name when ORS knows one ("Mighty Fine Rehearsal Studios"). */
  name?: string;
  /** The full label ("123 Main St, Denver, CO, USA"). */
  address: string;
  lat: number;
  lng: number;
  /** For the fuel price ladder ("Denver County", "CO"). */
  county?: string;
  state?: string;
}

export interface OrsService {
  autocomplete(q: string): Promise<OrsPlace[]>;
  /** The best match for a place name ("Boise, ID"), or null when ORS knows none. Used for fans' cities and venue towns. */
  geocode(text: string): Promise<{ lat: number; lng: number } | null>;
  reverse(lat: number, lng: number): Promise<{ county?: string; state?: string } | null>;
  /** One-way driving distance in miles and time in minutes (driving-car). */
  directions(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<{ oneWayMiles: number; minutes: number }>;
}

interface PeliasFeature {
  geometry: { coordinates: [number, number] };
  properties: { label?: string; name?: string; county?: string; region_a?: string; layer?: string };
}

const METERS_PER_MILE = 1609.344;

export function orsClient(baseUrl = process.env.ORS_BASE_URL ?? "http://127.0.0.1:3206"): OrsService {
  if (process.env.GOOGLE_MAPS_API_KEY) return googleMapsClient(process.env.GOOGLE_MAPS_API_KEY);
  const key = process.env.ORS_API_KEY ?? "";
  const call = jsonClient("ors", baseUrl, { authorization: key });
  const place = (f: PeliasFeature): OrsPlace => ({
    ...(f.properties.layer === "venue" && f.properties.name ? { name: f.properties.name } : {}),
    address: f.properties.label ?? f.properties.name ?? "",
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    ...(f.properties.county ? { county: f.properties.county } : {}),
    ...(f.properties.region_a ? { state: f.properties.region_a } : {}),
  });
  return {
    async autocomplete(q) {
      const r = await call<{ features: PeliasFeature[] }>("GET", "/geocode/autocomplete", { query: { text: q, api_key: key, "boundary.country": "US" } });
      return r.features.map(place);
    },
    async geocode(text) {
      const r = await call<{ features: PeliasFeature[] }>("GET", "/geocode/search", { query: { text, api_key: key, size: "1", "boundary.country": "US" } });
      const f = r.features[0];
      return f ? { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } : null;
    },
    async reverse(lat, lng) {
      const r = await call<{ features: PeliasFeature[] }>("GET", "/geocode/reverse", { query: { "point.lat": String(lat), "point.lon": String(lng), api_key: key } });
      const f = r.features[0];
      return f ? { ...(f.properties.county ? { county: f.properties.county } : {}), ...(f.properties.region_a ? { state: f.properties.region_a } : {}) } : null;
    },
    async directions(from, to) {
      const r = await call<{ routes: { summary: { distance: number; duration?: number } }[] }>("POST", "/v2/directions/driving-car", {
        body: { coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
      });
      return { oneWayMiles: r.routes[0].summary.distance / METERS_PER_MILE, minutes: (r.routes[0].summary.duration ?? 0) / 60 };
    },
  };
}
