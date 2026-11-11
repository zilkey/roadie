/** Artist slugs, artist-scoped routes, sign-in redirects and the legacy-URL proxy, with no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { artistSlug, slugForArtist } from "@/schema";
import { afterSignIn, artistPath, isLegacyPath, resolveRoute, routeForPath, splitArtistPath } from "@/lib/routes";
import { proxy } from "@/proxy";

test("slug format: lowercase words and single hyphens, 2-60 characters; names suggest one", () => {
  for (const ok of ["nora-quill", "band2", "a1-b2-c3"]) assert.ok(artistSlug.safeParse(ok).success, ok);
  for (const bad of ["Nora", "nora quill", "-nora", "nora-", "nora--quill", "x", "nora_quill", "a".repeat(61), "nora/quill"]) {
    assert.equal(artistSlug.safeParse(bad).success, false, bad);
  }
  assert.equal(slugForArtist("Nora Quill Band"), "nora-quill-band");
  assert.equal(slugForArtist("Bjørk & The Sugarcubes!"), "bj-rk-and-the-sugarcubes");
  assert.equal(slugForArtist("Café Tacvba"), "cafe-tacvba");
});

test("routes resolve inside the artist; paths map back to named routes", () => {
  assert.equal(artistPath("nora-quill"), "/artists/nora-quill/calendar");
  assert.equal(artistPath("nora-quill", "/shows/1"), "/artists/nora-quill/shows/1");
  assert.equal(resolveRoute("show", { id: "abc" }, "nora-quill")?.href, "/artists/nora-quill/shows/abc");
  assert.equal(resolveRoute("mcp", {}, "nora-quill")?.title, "Integrations");
  assert.equal(resolveRoute("calendar", {}, "../evil"), null);
  assert.deepEqual(routeForPath("/artists/nora-quill/shows/abc"), { route: "show", params: { id: "abc" }, artist: "nora-quill" });
  assert.deepEqual(routeForPath("/artists/nora-quill/admin/people"), { route: "people", params: {}, artist: "nora-quill" });
  assert.equal(routeForPath("/artists/nora-quill/nope"), null);
  assert.deepEqual(splitArtistPath("/artists/nora-quill"), { slug: "nora-quill", rest: "/calendar" });
  assert.deepEqual(splitArtistPath("/artists/nora-quill/setlists?q=hi"), { slug: "nora-quill", rest: "/setlists?q=hi" });
  assert.equal(splitArtistPath("/shows/1"), null);
  // every section root: a section missing here renders its links unscoped (toArtistHref), and they 404
  for (const p of ["/shows/1", "/booking", "/songs?setlist=x", "/setlists", "/setlists/t1", "/rehearsals", "/rehearsals/new", "/admin/people", "/money/expense"]) assert.ok(isLegacyPath(p), p);
  for (const p of ["/", "/artists", "/home", "/artists/x/home", "/signin", "/api/session", "/ask/1/2/3", "//evil.example", "/homes"]) assert.equal(isLegacyPath(p), false, p);
});

test("sign-in goes back to the page you came from, never off the app", () => {
  assert.equal(afterSignIn("/artists/nora-quill-band/booking/pitches/ss-bluebird"), "/artists/nora-quill-band/booking/pitches/ss-bluebird");
  assert.equal(afterSignIn("/artists/nora-quill-band/shows/1?tab=setlist"), "/artists/nora-quill-band/shows/1?tab=setlist");
  assert.equal(afterSignIn("/shows/1"), "/artists?next=%2Fshows%2F1");
  for (const p of [null, "", "/artists", "//evil.example/artists/x", "https://evil.example", "/api/session", "/signin"]) assert.equal(afterSignIn(p), "/artists", String(p));
});

test("old URLs redirect to /artists with the page as `next` (the picker opens it in your artist)", () => {
  const res = proxy(new NextRequest("http://localhost:3100/shows/123/after?x=1"));
  assert.equal(res.status, 307);
  const to = new URL(res.headers.get("location")!);
  assert.equal(to.pathname, "/artists");
  assert.equal(to.searchParams.get("next"), "/shows/123/after?x=1");
  const booking = new URL(proxy(new NextRequest("http://localhost:3100/booking")).headers.get("location")!);
  assert.equal(booking.searchParams.get("next"), "/booking");
});
