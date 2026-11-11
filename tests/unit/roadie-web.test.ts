// Roadie web guards: URL checks, allow-list, page text, tool list (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolDefs } from "@/server/assistant/tools";
import { allowUrls, checkUrl, isAllowedUrl, isBlockedAddress, newWebTurn, pageText, publicLookup, urlsIn } from "@/server/assistant/web";

test("non-public addresses are blocked: loopback, private, link-local (the metadata server), CGNAT, mapped v6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fe80::1", "fd00::1", "fc00::abcd", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "not-an-ip"]) assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "151.101.1.69", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isBlockedAddress(ip), false, ip);
});

test("checkUrl takes only https to a public host on the standard port", () => {
  for (const u of ["http://example.com/", "https://localhost/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://[fd00::1]/",
    "https://metadata.google.internal/", "https://printer.local/", "https://intranet/", "https://u:p@example.com/", "https://example.com:8443/", "file:///etc/passwd", "ftp://example.com/", "nope"]) {
    assert.throws(() => checkUrl(u), Error, u);
  }
  assert.equal(checkUrl("https://greyeagle.com/booking").hostname, "greyeagle.com");
  assert.equal(checkUrl("https://example.com:443/x").hostname, "example.com");
});

test("the connect-time lookup refuses hostnames that resolve to private addresses", async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((r) => publicLookup("localhost", {}, (e) => r(e)));
  assert.equal(err?.code, "EBLOCKED");
});

test("only links Roadie didn't make up may be read; links are matched exactly, trailing punctuation dropped", () => {
  assert.deepEqual(urlsIn("see https://greyeagle.com/booking. or (https://a.example/x?y=1)"), ["https://greyeagle.com/booking", "https://a.example/x?y=1"]);
  const w = newWebTurn();
  allowUrls(w, "check https://greyeagle.com/booking#top please");
  assert.equal(isAllowedUrl(w, "https://greyeagle.com/booking"), true); // the fragment doesn't matter
  assert.equal(isAllowedUrl(w, "https://greyeagle.com/booking?d=guarantee-500"), false); // no data tacked on
  assert.equal(isAllowedUrl(w, "https://evil.example/"), false);
});

test("page text drops scripts, styles and tags, keeps mailto addresses", () => {
  const p = pageText(`<html><head><title>The Grey Eagle &amp; Taqueria</title><style>p{}</style></head><body><script>alert(1)</script>
    <h1>Booking</h1><p>Capacity 550</p><!-- hidden --><a href="mailto:Booking@GreyEagle.com?subject=hi">email us</a></body></html>`);
  assert.equal(p.title, "The Grey Eagle & Taqueria");
  assert.match(p.text, /Booking\nCapacity 550/);
  assert.doesNotMatch(p.text, /alert|hidden|p\{\}/);
  assert.deepEqual(p.emails, ["booking@greyeagle.com"]);
});

test("web.search and web.read are offered to Roadie", () => {
  const names = toolDefs("admin").map((t) => t.name);
  assert.ok(names.includes("web.search") && names.includes("web.read"));
});
