import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml, sanitizeCss } from "@/server/sites/sanitize";
import { prepareSource, renderPage, renderSite, blockInputsOf, securityHeaders, type SiteFile, type BlockData } from "@/server/sites/render";

// docs/designs/sites, Decision 3 and Security: the sanitizer strips what can run code; render keeps the generated nodes.

const files: SiteFile[] = [
  { path: "index.html", kind: "page", body: `<title>Home</title><meta name="description" content="Songs"><h1>Ingrid</h1><roadie-shows limit="2"></roadie-shows><img src="/img/a.jpg" alt="A">` },
  { path: "about.html", kind: "page", body: `<h1>About</h1><a href="https://example.com" target="_blank">x</a>` },
  { path: "partials/header.html", kind: "partial", body: `<header><a href="/">Ingrid</a></header>` },
  { path: "partials/footer.html", kind: "partial", body: `<footer><roadie-links></roadie-links><roadie-signup></roadie-signup></footer>` },
  { path: "style.css", kind: "css", body: `@import url(x.css); body{color:red}` },
  { path: "site.json", kind: "config", body: JSON.stringify({ title: "Ingrid Avison", signupUrl: "https://list.example.com/join", redirects: [{ from: "/home", to: "/" }] }) },
  { path: "img/a.jpg", kind: "image", body: "a".repeat(64) },
];
const data: BlockData = {
  artistName: "Ingrid Avison",
  shows: [{ date: "2027-01-02", name: "Gold Hill Inn", place: "Boulder", ticketUrl: "https://t.example.com" }, { date: "2027-01-09", name: "The Bluebird" }, { date: "2027-02-01", name: "Third" }],
  links: [{ key: "spotify", label: "Spotify", url: "https://open.spotify.com/artist/1" }],
};
const opts = { mode: "public" as const, target: "live" as const, defaultHost: "ingrid.web.app" };

test("sanitizer: removes scripts, forms, handlers, javascript: urls, unknown iframes, base and meta refresh", () => {
  const r = sanitizeHtml(`<p onclick="x()">hi</p><script>alert(1)</script><form action="/x"><input></form><a href="javascript:alert(1)">a</a>
    <iframe src="https://evil.example.com"></iframe><iframe src="https://open.spotify.com/embed/artist/1"></iframe><base href="/"><meta http-equiv="refresh" content="0">
    <img src="data:text/html,x"><object data="x"></object><svg><foreignObject><p>x</p></foreignObject></svg><roadie-nope></roadie-nope>`);
  assert.doesNotMatch(r.html, /onclick|<script|<form|javascript:|evil\.example|<base|http-equiv|data:text|<object|foreignObject|roadie-nope/i);
  assert.match(r.html, /open\.spotify\.com/);
  assert.deepEqual(r.unknownBlocks, ["roadie-nope"]);
  assert.equal(sanitizeCss("@import url(x); a{background:url(javascript:x)}").includes("javascript"), false);
  assert.equal(sanitizeCss("@import url(x); a{}").includes("@import"), false);
});

test("prepareSource: an unknown block and bad site.json are refused; images go through upload", () => {
  assert.throws(() => prepareSource("index.html", "<roadie-gallery></roadie-gallery>"), /Unknown block/);
  assert.throws(() => prepareSource("site.json", "{"), /valid JSON/);
  assert.throws(() => prepareSource("img/x.jpg", ""), /uploadImage/);
  assert.equal(prepareSource("about.html", "<p>x</p>").kind, "page");
});

test("render: partials wrap the page; blocks, canonical and JSON-LD are generated; lifted title and description", () => {
  const { html } = renderPage({ files, data }, "index.html", opts);
  assert.match(html, /<title>Home<\/title>/);
  assert.match(html, /<meta name="description" content="Songs">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ingrid\.web\.app\/">/);
  assert.match(html, /<header><a href="\/">Ingrid<\/a><\/header>/);
  assert.equal((html.match(/class="roadie-show"/g) ?? []).length, 2, "limit=2");
  assert.match(html, /roadie-link-spotify/);
  assert.match(html, /href="https:\/\/list\.example\.com\/join"/);
  assert.match(html, /"@type":"MusicEvent"/);
  assert.match(html, /"@type":"MusicGroup"/);
  assert.doesNotMatch(html, /<roadie-/);
});

test("render: JSON-LD can't close its script tag", () => {
  const evil = { ...data, artistName: "</script><script>alert(1)</script>" };
  const { html } = renderPage({ files, data: evil }, "index.html", opts);
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
  assert.ok(ld.length > 0);
  for (const s of ld) assert.doesNotMatch(s.slice(35, -9), /<\/script/i);
});

test("render (preview): links point at #, images are signed app links, CSS is inlined, no canonical", () => {
  const { html } = renderPage({ files, data }, "index.html", { ...opts, mode: "preview", imageUrl: (p, sha) => `/api/sites/img/A/${sha}?sig=1` });
  assert.match(html, /<style>/);
  assert.match(html, /src="\/api\/sites\/img\/A\/a{64}\?sig=1"/);
  assert.doesNotMatch(html, /href="https:/);
  assert.doesNotMatch(html, /rel="canonical"/);
});

test("renderSite: every file, sitemap on the canonical host, robots never Disallow, redirects, staging noindex only", () => {
  const live = renderSite({ files, data }, opts);
  assert.deepEqual(Object.keys(live.files).sort(), ["/404.html", "/about.html", "/img/a.jpg", "/index.html", "/robots.txt", "/sitemap.xml", "/style.css"]);
  const sm = (live.files["/sitemap.xml"] as { text: string }).text;
  assert.match(sm, /https:\/\/ingrid\.web\.app\/about/);
  const robots = (live.files["/robots.txt"] as { text: string }).text;
  assert.doesNotMatch(robots, /Disallow/);
  assert.deepEqual(live.config.redirects, [{ glob: "/home", statusCode: 301, location: "/" }]);
  assert.equal(live.config.headers[0].headers["X-Robots-Tag"], undefined);
  const staging = renderSite({ files, data }, { ...opts, target: "staging" });
  assert.equal(staging.config.headers[0].headers["X-Robots-Tag"], "noindex");
  assert.deepEqual(staging.files["/index.html"], live.files["/index.html"], "the same bytes for live and staging");
  assert.doesNotMatch((live.files["/style.css"] as { text: string }).text, /@import/);
  assert.match((live.files["/about.html"] as { text: string }).text, /rel="noopener"/);
});

test("the CSP allows what a rendered page loads: fonts, the embed hosts, same-origin css and images", () => {
  const csp = securityHeaders("live")["Content-Security-Policy"];
  for (const want of ["https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://open.spotify.com", "https://www.youtube.com", "https://w.soundcloud.com", "img-src 'self' data:", "script-src 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(want), want);
});

test("blockInputs change with the show list, not otherwise", () => {
  assert.equal(blockInputsOf(data), blockInputsOf({ ...data }));
  assert.notEqual(blockInputsOf(data), blockInputsOf({ ...data, shows: data.shows.slice(1) }));
});
