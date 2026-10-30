import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { googleMapsClient } from "@/server/integrations/google-maps";
import { IntegrationError } from "@/server/integrations";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Seen = { url: URL; headers: Record<string, string>; body: unknown };
function stub(json: unknown, seen: Seen[] = []) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: new URL(String(input)), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(json), { status: 200 });
  }) as typeof fetch;
  return seen;
}
const maps = () => googleMapsClient("k123");
const comps = [
  { longText: "Denver County", shortText: "Denver County", types: ["administrative_area_level_2"] },
  { longText: "Colorado", shortText: "CO", types: ["administrative_area_level_1"] },
];

test("autocomplete maps places, names only venues, sends key and field mask", async () => {
  const seen = stub({ places: [
    { displayName: { text: "Larimer Lounge" }, formattedAddress: "2721 Larimer St, Denver, CO 80205, USA", location: { latitude: 39.76, longitude: -104.98 }, addressComponents: comps, types: ["establishment", "bar"] },
    { displayName: { text: "123 Main St" }, formattedAddress: "123 Main St, Denver, CO, USA", location: { latitude: 1, longitude: 2 }, addressComponents: comps, types: ["street_address"] },
  ] });
  const r = await maps().autocomplete("larimer");
  assert.deepEqual(r[0], { name: "Larimer Lounge", address: "2721 Larimer St, Denver, CO 80205, USA", lat: 39.76, lng: -104.98, county: "Denver County", state: "CO" });
  assert.equal("name" in r[1], false);
  assert.equal(seen[0].url.pathname, "/v1/places:searchText");
  assert.equal(seen[0].headers["X-Goog-Api-Key"], "k123");
  assert.match(seen[0].headers["X-Goog-FieldMask"], /places\.addressComponents/);
  assert.deepEqual(seen[0].body, { textQuery: "larimer", regionCode: "US", pageSize: 5 });
});

test("autocomplete with no places is empty", async () => {
  stub({});
  assert.deepEqual(await maps().autocomplete("zzz"), []);
});

test("geocode returns lat/lng, null on ZERO_RESULTS, throws on REQUEST_DENIED", async () => {
  const seen = stub({ status: "OK", results: [{ geometry: { location: { lat: 43.6, lng: -116.2 } }, address_components: [] }] });
  assert.deepEqual(await maps().geocode("Boise, ID"), { lat: 43.6, lng: -116.2 });
  assert.equal(seen[0].url.searchParams.get("key"), "k123");
  assert.equal(seen[0].url.searchParams.get("address"), "Boise, ID");
  assert.equal(seen[0].url.searchParams.get("components"), "country:US");
  stub({ status: "ZERO_RESULTS", results: [] });
  assert.equal(await maps().geocode("nowhere"), null);
  stub({ status: "REQUEST_DENIED", error_message: "key invalid", results: [] });
  await assert.rejects(maps().geocode("x"), (e: unknown) => e instanceof IntegrationError && /REQUEST_DENIED: key invalid/.test(e.message));
});

test("reverse finds county and state, searching later results", async () => {
  const seen = stub({ status: "OK", results: [
    { geometry: { location: { lat: 0, lng: 0 } }, address_components: [{ long_name: "Main St", short_name: "Main St", types: ["route"] }] },
    { geometry: { location: { lat: 0, lng: 0 } }, address_components: [
      { long_name: "Denver County", short_name: "Denver County", types: ["administrative_area_level_2"] },
      { long_name: "Colorado", short_name: "CO", types: ["administrative_area_level_1"] }] },
  ] });
  assert.deepEqual(await maps().reverse(39.7, -105), { county: "Denver County", state: "CO" });
  assert.equal(seen[0].url.searchParams.get("latlng"), "39.7,-105");
  stub({ status: "ZERO_RESULTS", results: [] });
  assert.equal(await maps().reverse(0, 0), null);
});

test("directions converts meters to miles and seconds to minutes", async () => {
  const seen = stub({ routes: [{ distanceMeters: 1609.344 * 10, duration: "3600s" }] });
  const r = await maps().directions({ lat: 1, lng: 2 }, { lat: 3, lng: 4 });
  assert.ok(Math.abs(r.oneWayMiles - 10) < 1e-9);
  assert.equal(r.minutes, 60);
  assert.equal(seen[0].headers["X-Goog-FieldMask"], "routes.distanceMeters,routes.duration");
  assert.equal(seen[0].headers["X-Goog-Api-Key"], "k123");
  assert.deepEqual(seen[0].body, { origin: { location: { latLng: { latitude: 1, longitude: 2 } } }, destination: { location: { latLng: { latitude: 3, longitude: 4 } } }, travelMode: "DRIVE" });
  stub({});
  await assert.rejects(maps().directions({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }), /no route/);
});
