// An act's Look up (#78): the pure parts, no emulator, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asHttps, groundedLink, cleanGenres, factsFrom, sameName, FAKE_FOUNTAIN, MAX_GENRES, ogImage, spotifyIdsIn, isInstagramPhoto, ownPages, socialLinksIn, ownProfile } from "@/server/assistant/actLookup";
import { actSearchUrl } from "@/lib/acts";
import { isGroundingRedirect, resolveSource } from "@/server/assistant/web";
import { spotifyArtistId, pickImage, catalogHosts, toHit } from "@/server/integrations/spotify";

const SOURCES = [
  "https://abrothersfountain.example/about",
  "https://www.instagram.com/abrothersfountain/",
  "https://abrothersfountain.bandcamp.com/album/first-light",
];

test("groundedLink: the exact page, or a page above a source, is kept", () => {
  assert.equal(groundedLink("https://abrothersfountain.example/about", SOURCES), "https://abrothersfountain.example/about");
  assert.equal(groundedLink("https://abrothersfountain.example/", SOURCES), "https://abrothersfountain.example/");
  assert.equal(groundedLink("https://abrothersfountain.bandcamp.com/", SOURCES), "https://abrothersfountain.bandcamp.com/");
  assert.equal(groundedLink("https://www.instagram.com/abrothersfountain/", SOURCES), "https://www.instagram.com/abrothersfountain/");
});

test("groundedLink: other hosts, bare shared hosts, other handles and pages not under a source are dropped", () => {
  assert.equal(groundedLink("https://elsewhere.example/", SOURCES), undefined);
  assert.equal(groundedLink("https://www.youtube.com/@abrothersfountain-made-up", SOURCES), undefined);
  assert.equal(groundedLink("https://instagram.com/", SOURCES), undefined, "bare instagram.com");
  assert.equal(groundedLink("https://www.instagram.com/someoneelse", SOURCES), undefined);
  assert.equal(groundedLink("https://abrothersfountain.example/store", SOURCES), undefined, "a page the source is not under");
  assert.equal(groundedLink("https://abrothersfountain.example/", []), undefined, "no sources vouch for nothing");
});

test("groundedLink: http becomes https; garbage and empties are undefined", () => {
  assert.equal(groundedLink("http://abrothersfountain.example/about", SOURCES), "https://abrothersfountain.example/about");
  assert.equal(groundedLink("abrothersfountain.example/about", SOURCES), "https://abrothersfountain.example/about");
  for (const bad of ["not a url", "", "   ", null, undefined, "ftp://abrothersfountain.example/", "javascript:alert(1)"]) {
    assert.equal(groundedLink(bad as never, SOURCES), undefined, String(bad));
  }
});

test("asHttps", () => {
  assert.equal(asHttps("abrothersfountain.com"), "https://abrothersfountain.com/");
  assert.equal(asHttps("  http://x.example/a  "), "https://x.example/a");
  assert.equal(asHttps("https://x.example/a"), "https://x.example/a");
  assert.equal(asHttps(""), undefined);
  assert.equal(asHttps(null), undefined);
  assert.equal(asHttps(undefined), undefined);
  assert.equal(asHttps("localhost"), undefined, "needs a dot");
  assert.equal(asHttps("ftp://x.example/"), undefined);
});

test("cleanGenres: lowercase, trimmed, de-duplicated, at most six, lists merged", () => {
  assert.deepEqual(cleanGenres(["Folk", " americana ", "FOLK", "", "Indie   Folk"]), ["folk", "americana", "indie folk"]);
  assert.deepEqual(cleanGenres(["folk"], ["Folk", "bluegrass"]), ["folk", "bluegrass"]);
  assert.deepEqual(cleanGenres(null, undefined, ["a"]), ["a"]);
  assert.equal(MAX_GENRES, 6);
  assert.deepEqual(cleanGenres(["a", "b", "c", "d", "e", "f", "g", "h"]), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(cleanGenres(["x".repeat(41), "ok"]), ["ok"], "absurdly long ones are dropped");
});

test("factsFrom the canned fountain: the made-up YouTube link is dropped, the rest kept", () => {
  const f = factsFrom(FAKE_FOUNTAIN.out, FAKE_FOUNTAIN.sources.map((s) => s.url));
  assert.deepEqual(f.links, {
    website: "https://abrothersfountain.example/",
    instagram: "https://www.instagram.com/abrothersfountain/",
    bandcamp: "https://abrothersfountain.bandcamp.com/",
  });
  assert.ok(!Object.keys(f.links).includes("youtube"));
  assert.equal(f.hometown, "Fort Collins, CO");
  assert.deepEqual(f.genres, ["folk", "americana"]);
  assert.match(f.description!, /Fort Collins folk/);
});

test("factsFrom: a website that is really an Instagram page is dropped; nothing in, nothing out", () => {
  const f = factsFrom({ ...FAKE_FOUNTAIN.out, website: "https://www.instagram.com/abrothersfountain/" }, FAKE_FOUNTAIN.sources.map((s) => s.url));
  assert.equal(f.links.website, undefined);
  assert.equal(f.links.instagram, "https://www.instagram.com/abrothersfountain/");
  assert.deepEqual(factsFrom(null, []), { links: {}, genres: [] });
  assert.deepEqual(factsFrom(undefined, []), { links: {}, genres: [] });
  const none = factsFrom({ ...FAKE_FOUNTAIN.out, hometown: "  ", description: null, genres: [] }, FAKE_FOUNTAIN.sources.map((s) => s.url));
  assert.equal(none.hometown, undefined);
  assert.equal(none.description, undefined);
});

test("sameName matches by act key, not by looser prefix", () => {
  const hit = (name: string) => ({ id: name, name, url: "https://open.spotify.com/artist/" + name, genres: [] });
  const hits = [hit("A Brother's Fountain"), hit("The Wheelwright"), hit("Wheelwright Revival"), hit("Other")];
  assert.deepEqual(sameName(hits, "a brother's FOUNTAIN").map((h) => h.name), ["A Brother's Fountain"]);
  assert.deepEqual(sameName(hits, "Wheelwright").map((h) => h.name), ["The Wheelwright"], "'The' is ignored");
  assert.deepEqual(sameName(hits, "Wheel"), []);
});

test("spotifyArtistId", () => {
  assert.equal(spotifyArtistId("https://open.spotify.com/artist/4BrothersFountainCO01"), "4BrothersFountainCO01");
  assert.equal(spotifyArtistId("https://open.spotify.com/artist/4BrothersFountainCO01?si=abc"), "4BrothersFountainCO01");
  assert.equal(spotifyArtistId("https://open.spotify.com/intl-de/artist/4BrothersFountainCO01"), "4BrothersFountainCO01");
  assert.equal(spotifyArtistId("https://open.spotify.com/album/4BrothersFountainCO01"), undefined);
  assert.equal(spotifyArtistId("https://open.spotify.com/artist/short"), undefined);
  assert.equal(spotifyArtistId("https://example.com/artist/4BrothersFountainCO01"), undefined);
  assert.equal(spotifyArtistId("nonsense"), undefined);
  assert.equal(spotifyArtistId(undefined), undefined);
});

test("pickImage: about 300px wide when there is one, else the biggest; none is undefined", () => {
  const img = (w: number | null) => ({ url: `https://i.example/${w}.jpg`, width: w, height: w });
  assert.equal(pickImage([img(640), img(320), img(160)]), "https://i.example/320.jpg");
  assert.equal(pickImage([img(160), img(640)]), "https://i.example/640.jpg");
  assert.equal(pickImage([img(null)]), "https://i.example/null.jpg");
  assert.equal(pickImage([]), undefined);
  assert.equal(pickImage(undefined), undefined);
  assert.equal(toHit({ id: "x", name: "N", genres: [" Folk ", ""], images: [img(320)] }).imageUrl, "https://i.example/320.jpg");
  assert.deepEqual(toHit({ id: "x", name: "N", images: [] }).genres, [], "no genres key");
  assert.deepEqual(toHit({ id: "x", name: "N" }), { id: "x", name: "N", url: "https://open.spotify.com/artist/x", genres: [] });
});

test("catalogHosts: the fake when SPOTIFY_BASE_URL is set or there are no credentials; the real hosts with credentials only", () => {
  assert.deepEqual(catalogHosts({ SPOTIFY_BASE_URL: "http://127.0.0.1:9999" }), { accounts: "http://127.0.0.1:9999", api: "http://127.0.0.1:9999", id: "fake-client", secret: "fake-secret" });
  assert.equal(catalogHosts({ SPOTIFY_BASE_URL: "http://127.0.0.1:9999", SPOTIFY_CLIENT_ID: "i", SPOTIFY_CLIENT_SECRET: "s" }).api, "http://127.0.0.1:9999", "the fake wins");
  assert.deepEqual(catalogHosts({ SPOTIFY_CLIENT_ID: "i", SPOTIFY_CLIENT_SECRET: "s" }), { accounts: "https://accounts.spotify.com", api: "https://api.spotify.com", id: "i", secret: "s" });
  assert.equal(catalogHosts({}).api, "http://127.0.0.1:3205");
  assert.equal(catalogHosts({ SPOTIFY_CLIENT_ID: "i" }).api, "http://127.0.0.1:3205", "one half of the credentials is none");
});

test("isGroundingRedirect and resolveSource", async () => {
  assert.equal(isGroundingRedirect("https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"), true);
  assert.equal(isGroundingRedirect("https://example.com/"), false);
  assert.equal(isGroundingRedirect("https://vertexaisearch.cloud.google.com.evil.example/x"), false);
  assert.equal(isGroundingRedirect("nonsense"), false);
  assert.equal(await resolveSource("https://abrothersfountain.example/about"), "https://abrothersfountain.example/about");
});

test("ogImage: the og:image content either way round, with entities decoded", () => {
  assert.equal(ogImage('<head><meta property="og:image" content="https://scontent.cdninstagram.com/v/a.jpg?x=1&amp;y=2" /></head>'), "https://scontent.cdninstagram.com/v/a.jpg?x=1&y=2");
  assert.equal(ogImage("<meta content='https://x.fbcdn.net/p.jpg' property='og:image'>"), "https://x.fbcdn.net/p.jpg");
  assert.equal(ogImage('<meta property="og:title" content="Nope">'), undefined);
});

test("isInstagramPhoto: only Instagram's own image hosts", () => {
  assert.ok(isInstagramPhoto("https://scontent-dfw5-2.cdninstagram.com/v/t51/p.jpg"));
  assert.ok(isInstagramPhoto("https://scontent.xx.fbcdn.net/p.jpg"));
  assert.ok(!isInstagramPhoto("https://static.cdninstagram.com.evil.example/logo.png"));
  assert.ok(!isInstagramPhoto("not a url"));
});

test("spotifyIdsIn: artist links on a page, with or without a locale, each once", () => {
  const html = '<a href="https://open.spotify.com/artist/4BrothersFountainCO01x?si=1">x</a> <a href="https://open.spotify.com/intl-de/artist/4BrothersFountainCO01x">y</a> ' +
    '<a href="https://open.spotify.com/album/4BrothersFountainCO01y">album</a>';
  assert.deepEqual(spotifyIdsIn(html), ["4BrothersFountainCO01x"]);
});

test("ownPages: website, Bandcamp and link-in-bio sources, at most four", () => {
  assert.deepEqual(
    ownPages({ website: "https://band.example/", bandcamp: "https://band.bandcamp.com/", instagram: "https://www.instagram.com/band/" },
      ["https://linktr.ee/band", "https://www.westword.com/music/band", "https://band.example/"]),
    ["https://band.example/", "https://band.bandcamp.com/", "https://linktr.ee/band"],
  );
  assert.deepEqual(ownPages({}, []), []);
});

test("actSearchUrl: the quoted name, band, and up to two cities it played", () => {
  assert.equal(actSearchUrl("Sunshowers", ["Denver", "Denver", "Boulder", "Fort Collins"]), `https://www.google.com/search?q=${encodeURIComponent('"Sunshowers" band Denver Boulder')}`);
  assert.equal(actSearchUrl("AWAY"), `https://www.google.com/search?q=${encodeURIComponent('"AWAY" band')}`);
});

test("socialLinksIn: profiles only, not posts, share buttons or the pixel", () => {
  const html = '<a href="https://www.instagram.com/SunShowersBand/">ig</a> <a href="https://instagram.com/p/Cx1/">post</a> ' +
    '<a href="https://www.facebook.com/sunshowersband">fb</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a> ' +
    '<img src="https://www.facebook.com/tr?id=1&amp;ev=PageView"> <a href="https://m.facebook.com/profile.php?id=12345&amp;ref=x">p</a>';
  assert.deepEqual(socialLinksIn(html), {
    instagram: ["https://www.instagram.com/sunshowersband/"],
    facebook: ["https://www.facebook.com/sunshowersband/", "https://www.facebook.com/profile.php?id=12345"],
  });
});

test("ownProfile: the only one, else the one named like the act, else none", () => {
  const ig = (h: string) => `https://www.instagram.com/${h}/`;
  assert.equal(ownProfile([ig("whatever")], "Sunshowers"), ig("whatever"));
  assert.equal(ownProfile([ig("hidivedenver"), ig("sunshowersband")], "Sunshowers"), ig("sunshowersband"));
  assert.equal(ownProfile([ig("thebandname"), ig("label")], "The Band Name"), ig("thebandname"));
  assert.equal(ownProfile([ig("one"), ig("two")], "Sunshowers"), undefined);
  assert.equal(ownProfile([], "Sunshowers"), undefined);
});
