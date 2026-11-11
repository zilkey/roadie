/**
 * Google Maps Platform behind OrsService: Places API (New) text search for autocomplete, Geocoding API for geocode/reverse,
 * Routes API for driving distance and time. One key (GOOGLE_MAPS_API_KEY) restricted to those three APIs; it stays on the server.
 */
import { jsonClient, IntegrationError } from "./http";
import type { OrsPlace, OrsService } from "./ors";

const METERS_PER_MILE = 1609.344;
const SVC = "google-maps";

interface Component { longText?: string; shortText?: string; types: string[] }
interface GPlace { displayName?: { text?: string }; formattedAddress?: string; location: { latitude: number; longitude: number }; addressComponents?: Component[]; types?: string[] }
interface GeoComponent { long_name: string; short_name: string; types: string[] }
interface GeoResponse { status: string; error_message?: string; results: { geometry: { location: { lat: number; lng: number } }; address_components: GeoComponent[] }[] }

export function googleMapsClient(
  key: string,
  bases = { places: "https://places.googleapis.com", geocode: "https://maps.googleapis.com", routes: "https://routes.googleapis.com" },
): OrsService {
  const places = jsonClient(SVC, bases.places, { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.addressComponents,places.types" });
  const routes = jsonClient(SVC, bases.routes, { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" });
  const geo = jsonClient(SVC, bases.geocode);
  const geocodeCall = async (query: Record<string, string>) => {
    const r = await geo<GeoResponse>("GET", "/maps/api/geocode/json", { query: { ...query, key } });
    if (r.status === "ZERO_RESULTS") return [];
    if (r.status !== "OK") throw new IntegrationError(SVC, 502, `${r.status}: ${r.error_message ?? ""}`);
    return r.results;
  };
  const named = (t?: string[]) => !!t?.some((x) => x === "establishment" || x === "point_of_interest");
  const latLng = (p: { lat: number; lng: number }) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  return {
    async autocomplete(q) {
      const r = await places<{ places?: GPlace[] }>("POST", "/v1/places:searchText", { body: { textQuery: q, regionCode: "US", pageSize: 5 } });
      return (r.places ?? []).map((p): OrsPlace => {
        const county = p.addressComponents?.find((c) => c.types.includes("administrative_area_level_2"))?.longText;
        const state = p.addressComponents?.find((c) => c.types.includes("administrative_area_level_1"))?.shortText;
        return {
          ...(named(p.types) && p.displayName?.text ? { name: p.displayName.text } : {}),
          address: p.formattedAddress ?? p.displayName?.text ?? "",
          lat: p.location.latitude, lng: p.location.longitude,
          ...(county ? { county } : {}), ...(state ? { state } : {}),
        };
      });
    },
    async geocode(text) {
      const r = (await geocodeCall({ address: text, components: "country:US" }))[0];
      return r ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng } : null;
    },
    async reverse(lat, lng) {
      const results = await geocodeCall({ latlng: `${lat},${lng}` });
      if (!results.length) return null;
      const find = (type: string, f: "long_name" | "short_name") => results.flatMap((x) => x.address_components).find((c) => c.types.includes(type))?.[f];
      const county = find("administrative_area_level_2", "long_name"), state = find("administrative_area_level_1", "short_name");
      return { ...(county ? { county } : {}), ...(state ? { state } : {}) };
    },
    async directions(from, to) {
      const r = await routes<{ routes?: { distanceMeters?: number; duration?: string }[] }>("POST", "/directions/v2:computeRoutes", {
        body: { origin: latLng(from), destination: latLng(to), travelMode: "DRIVE" },
      });
      const route = r.routes?.[0];
      if (!route) throw new IntegrationError(SVC, 404, "no route");
      return { oneWayMiles: (route.distanceMeters ?? 0) / METERS_PER_MILE, minutes: parseFloat(route.duration ?? "0") / 60 };
    },
  };
}
