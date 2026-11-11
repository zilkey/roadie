import { test } from "node:test";
import assert from "node:assert/strict";
import { linkify } from "@/lib/linkify";

test("linkify leaves plain text alone", () => {
  assert.deepEqual(linkify("No links here."), [{ text: "No links here." }]);
  assert.deepEqual(linkify(""), []);
});

test("linkify links bare http(s) URLs and leaves the sentence's punctuation out", () => {
  assert.deepEqual(linkify("The web has something: https://example.com/booking."), [
    { text: "The web has something: " }, { text: "https://example.com/booking", href: "https://example.com/booking" }, { text: "." },
  ]);
  assert.deepEqual(linkify("(see http://a.com/x?y=1&z=2)"), [
    { text: "(see " }, { text: "http://a.com/x?y=1&z=2", href: "http://a.com/x?y=1&z=2" }, { text: ")" },
  ]);
  assert.deepEqual(linkify("https://en.wikipedia.org/wiki/Foo_(band), ok"), [
    { text: "https://en.wikipedia.org/wiki/Foo_(band)", href: "https://en.wikipedia.org/wiki/Foo_(band)" }, { text: ", ok" },
  ]);
  assert.equal(linkify("one https://a.com two https://b.com").filter((s) => s.href).length, 2);
});

test("linkify reads markdown links as label + destination", () => {
  assert.deepEqual(linkify("Booking is on [their site](https://venue.com/book)."), [
    { text: "Booking is on " }, { text: "their site", href: "https://venue.com/book" }, { text: "." },
  ]);
});

test("linkify never links other schemes", () => {
  for (const t of ["javascript:alert(1)", "[x](javascript:alert(1))", "mailto:a@b.com", "ftp://a.com", "/artists/x"]) {
    assert.ok(linkify(t).every((s) => !s.href), t);
  }
});
