/** Search Gmail without a database: the signature heuristic, the fake's query matcher, threadsQuery, groupPeople. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matches } from "../../fakes/fake-gmail/query";
import { signatureOf, nameFromAddress } from "@/lib/email-signature";
import { threadsQuery, groupPeople } from "@/server/commands/email";
import { isExcluded } from "@/server/assistant/policy";

test("signatureOf: phone from any line, title from the line after the name; three real shapes and none", () => {
  assert.deepEqual(signatureOf("Dec 11 works.\n\nBest,\nRosa Jackson\nTalent buyer, Pine Hollow Lounge\n(303) 555-0101", "Rosa Jackson"),
    { phone: "(303) 555-0101", title: "Talent buyer, Pine Hollow Lounge" });
  assert.deepEqual(signatureOf("Sounds good!\n\n--\nDesmond Webb\nDirector of Programming\nHeron Theatre\nM: 303.555.0188\ndesmond@heron.example\nwww.heron.example", "Desmond Webb"),
    { phone: "303.555.0188", title: "Director of Programming" });
  assert.deepEqual(signatureOf("Thanks,\nWren\nWren Ortiz\nTel +1 720 555 0142\n\nOn Tue, Rudy wrote:\n> Hi\n> Rudy\n> (999) 555-0000", "Wren Ortiz"),
    { phone: "+1 720 555 0142" }, "the quoted part is not read, and a phone line is not a title");
  assert.deepEqual(signatureOf("Got it, thanks.", "Anika Shah"), {});
  assert.deepEqual(signatureOf("Got it, thanks.\nAnika Shah", ""), {}, "no display name, no title");
});

test("nameFromAddress guesses a name from the local part", () => {
  assert.equal(nameFromAddress("booking@pinehollow.example"), "Booking");
  assert.equal(nameFromAddress("rosa.jackson+x@pinehollow.example"), "Rosa Jackson");
});

test("the fake's search understands @domain, a display name after from:, and quoted phrases", () => {
  const m = { from: "rosa@pinehollow.example", fromName: "Rosa Jackson", to: ["rudy@example.com"], cc: [], subject: "Your submission to Pine Hollow Lounge", body: "Thanks" };
  assert.equal(matches("from:@pinehollow.example OR to:@pinehollow.example", m), true);
  assert.equal(matches("from:@other.example", m), false);
  assert.equal(matches('from:"Rosa Jackson"', m), true);
  assert.equal(matches('(from:(x@y.example) OR to:(x@y.example)) OR ("Pine Hollow Lounge")', m), true);
  assert.equal(matches('from:(x@y.example) OR ("Nowhere")', m), false);
});

test("threadsQuery: contacts, domain and the text, in the shape the contract names", () => {
  assert.equal(threadsQuery({ addresses: ["a@x.example", "b@x.example"], text: '"Pine Hollow"' }),
    'from:(a@x.example OR b@x.example) OR to:(a@x.example OR b@x.example) OR ("Pine Hollow")');
  assert.equal(threadsQuery({ addresses: ["a@x.example"], domain: "x.example", text: "" }), "from:a@x.example OR to:a@x.example OR from:@x.example OR to:@x.example");
  assert.equal(threadsQuery({ addresses: [], text: " " }), "");
});

test("both commands are off Roadie's menu", () => {
  assert.equal(isExcluded("email.search"), true);
  assert.equal(isExcluded("email.people"), true);
});

test("groupPeople: a message to someone else is not about the person searched for", () => {
  const msg = (o: object) => ({ id: "m", threadId: "t", account: "rudy@example.com", direction: "received", from: "", fromName: "", to: ["rudy@example.com"], cc: [], subject: "", body: "", date: "2026-10-01T00:00:00Z", ...o }) as any;
  const out = groupPeople([msg({ from: "a@pinehollow.example" }), msg({ from: "z@zzz.example", to: ["rudy@example.com", "a@pinehollow.example"] })], "rudy@example.com", "pinehollow.example", []);
  assert.deepEqual(out.map((p) => p.email), ["a@pinehollow.example"]);
});
