/** Compose page helpers: the "Fills in" words, the local-part name guess, the ?target= parser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldsInWords, joinWords, nameFromAddress, parseTarget } from "@/lib/email-compose";

test("fieldsInWords names the template fields in words, once each, in field order", () => {
  assert.equal(fieldsInWords("{{venue.name}} · Band", "Hi {{contact.firstName}},\nLive: {{artist.video}}\n{{user.name}} {{ user.name }}"),
    "the venue's name, their first name, your video link and your name");
  assert.equal(fieldsInWords("Following up", "Hello there"), "");
  assert.equal(fieldsInWords("{{target.name}}", ""), "the place's name");
  assert.equal(joinWords(["a", "b"]), "a and b");
});

test("nameFromAddress title-cases the local part", () => {
  assert.equal(nameFromAddress("booking@lostlake.example"), "Booking");
  assert.equal(nameFromAddress("jane.doe@x.com"), "Jane Doe");
  assert.equal(nameFromAddress("lost_lake-booking+web@x.com"), "Lost Lake Booking");
  assert.equal(nameFromAddress("HELLO@x.com"), "Hello");
});

test("parseTarget reads kind:id and nothing else", () => {
  assert.deepEqual(parseTarget("venue:abc"), { kind: "venue", id: "abc" });
  assert.deepEqual(parseTarget("edition:e_1"), { kind: "edition", id: "e_1" });
  assert.equal(parseTarget("show:abc"), null);
  assert.equal(parseTarget(null), null);
});
