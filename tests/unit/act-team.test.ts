// "Find their team" on an act's Contacts card: the pure parts, no emulator, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeTeam, emailsIn, FAKE_TEAM, groundPerson, groundTeam, linkedInHrefs, nameTokens, roleFromEmail, roleNear, teamPageLinks } from "@/server/assistant/actTeam";
import { sameTeamName, teamContactInput, teamContactMatch, teamContactPatch, teamNote, type TeamPerson } from "@/lib/acts";

test("teamPageLinks: same-site contact, booking, about and press pages; not the home page, other sites or files", () => {
  const html = `
    <a href="/">Home</a><a href="/music">Music</a>
    <a href="/contact">Contact</a><a href="https://www.band.example/booking/">Book us</a>
    <a href="/pages/the-team">Our people</a><a href="/epk.pdf">EPK</a>
    <a href="https://agency.example/contact">Agency</a><a href="#about">About</a><a href="/info">Info</a>`;
  assert.deepEqual(teamPageLinks(html, "https://band.example/"), [
    "https://band.example/contact", "https://www.band.example/booking/", "https://band.example/pages/the-team", "https://band.example/info",
  ]);
  assert.deepEqual(teamPageLinks(html, "not a url"), []);
});

test("emailsIn: lowercase, once each, no image names or tracker addresses", () => {
  assert.deepEqual(emailsIn("Booking: Jo@Agency.com. Also jo@agency.com, logo@2x.png, abc@o123.ingest.sentry.io, noreply@band.com"), ["jo@agency.com"]);
});

test("roleFromEmail and roleNear: the words just above the address win, then the address itself", () => {
  assert.equal(roleFromEmail("booking@band.com"), "booking");
  assert.equal(roleFromEmail("mgmt@band.com"), "management");
  assert.equal(roleFromEmail("press@band.com"), "publicity");
  assert.equal(roleFromEmail("hello@band.com"), "general");
  assert.equal(roleFromEmail("jo@agency.com"), undefined);
  assert.equal(roleNear("Booking: jo@agency.com", "jo@agency.com"), "booking");
  assert.equal(roleNear("Management\nmgmt@band.com\nGeneral\nhello@band.com", "hello@band.com"), "general", "the mgmt address above says nothing");
  assert.equal(roleNear("Some text\njo@agency.com", "jo@agency.com"), "other");
});

test("groundTeam: page emails and named people stay, a made-up email goes, unclaimed page addresses are added", () => {
  const people = groundTeam(FAKE_TEAM.people, FAKE_TEAM.pages, FAKE_TEAM.answer);
  assert.deepEqual(people, [
    { role: "booking", name: "Dana Reyes", company: "Front Range Touring", email: "dana@frontrangetouring.example", phone: "+19705550142", source: "https://abrothersfountain.example/contact" },
    { role: "booking", name: "D. Reyes", source: "https://abrothersfountain.example/contact" },
    { role: "management", email: "mgmt@abrothersfountain.example", source: "https://abrothersfountain.example/contact" },
    { role: "publicity", name: "Sam Ortiz" },
    { role: "publicity", email: "sam@ortizpr.example", source: "https://abrothersfountain.example/contact" },
    { role: "general", email: "hello@abrothersfountain.example", source: "https://abrothersfountain.example/contact" },
  ], "the duplicates are dedupeTeam's to fold");
});

test("dedupeTeam on the fake team: D. Reyes folds into Dana Reyes, the press inbox into Sam Ortiz once the search finds it", () => {
  const team = groundTeam(FAKE_TEAM.people, FAKE_TEAM.pages, FAKE_TEAM.answer);
  const people = team.map((p) => p.name === "Sam Ortiz" ? { ...p, ...groundPerson(p, FAKE_TEAM.person.pages, FAKE_TEAM.person.sources) } : p);
  const out = dedupeTeam(people, team);
  assert.deepEqual(out.map((p) => [p.role, p.name ?? p.email]), [
    ["booking", "Dana Reyes"], ["management", "mgmt@abrothersfountain.example"], ["publicity", "Sam Ortiz"], ["general", "hello@abrothersfountain.example"],
  ]);
  assert.deepEqual(out[2], {
    role: "publicity", name: "Sam Ortiz", email: "sam@ortizpr.example", phone: "+13035550177",
    source: "https://abrothersfountain.example/contact", infoFrom: "https://ortizpr.example/team",
    links: ["https://www.linkedin.com/in/sam-ortiz-pr", "https://ortizpr.example/team"],
  });
});

test("dedupeTeam: an address is on one person only; the one who had it before the search keeps it, else the first", () => {
  const before: TeamPerson[] = [
    { role: "booking", name: "Ann Lee", company: "Big Agency" },
    { role: "booking", name: "Bo Diaz", email: "booking@agency.com", source: "https://band.example/contact" },
  ];
  // Ann's search turned up the agency's shared inbox, which Bo already had from the act's page.
  const after = [{ ...before[0], email: "booking@agency.com", infoFrom: "https://agency.com/roster" }, before[1]];
  assert.deepEqual(dedupeTeam(after, before), [
    { role: "booking", name: "Ann Lee", company: "Big Agency", infoFrom: "https://agency.com/roster" },
    { role: "booking", name: "Bo Diaz", email: "booking@agency.com", source: "https://band.example/contact" },
  ]);
  // Two searches found the same shared address: only the first keeps it.
  const both = [{ role: "booking" as const, name: "Ann Lee", email: "booking@agency.com" }, { role: "booking" as const, name: "Bo Diaz", email: "booking@agency.com" }];
  assert.deepEqual(dedupeTeam(both, both.map(({ email: _, ...p }) => p)), [both[0], { role: "booking", name: "Bo Diaz" }]);
});

test("dedupeTeam: a person and an inbox with the same address are one row, under the person's name and role, with both pages", () => {
  const before: TeamPerson[] = [
    { role: "management", name: "Kim Hall", source: "https://mgmt.example/roster", links: ["https://www.linkedin.com/in/kim-hall"] },
    { role: "general", email: "kim@mgmt.example", source: "https://band.example/contact" },
  ];
  const after = [{ ...before[0], email: "kim@mgmt.example", infoFrom: "https://mgmt.example/team" }, before[1]];
  assert.deepEqual(dedupeTeam(after, before), [{
    role: "management", name: "Kim Hall", email: "kim@mgmt.example", source: "https://mgmt.example/roster", infoFrom: "https://mgmt.example/team",
    links: ["https://www.linkedin.com/in/kim-hall", "https://band.example/contact"],
  }]);
  // No infoFrom of their own: the inbox's page is where the email was.
  const plain = [{ role: "management" as const, name: "Kim Hall", email: "kim@mgmt.example", source: "https://mgmt.example/roster" }, before[1]];
  assert.deepEqual(dedupeTeam(plain, [{ role: "management", name: "Kim Hall", source: "https://mgmt.example/roster" }, before[1]]), [
    { role: "management", name: "Kim Hall", email: "kim@mgmt.example", source: "https://mgmt.example/roster", infoFrom: "https://band.example/contact" },
  ]);
});

test("dedupeTeam: name variants are one person, under the fuller name; different first names stay apart", () => {
  const people: TeamPerson[] = [
    { role: "booking", name: "JP Pineda", email: "jp@agency.com" },
    { role: "other", name: 'Joseph "JP" Pineda', phone: "+13035550100", source: "https://agency.com/roster" },
    { role: "booking", name: "J. Pineda", links: ["https://www.linkedin.com/in/jp-pineda"] },
    { role: "booking", name: "Maria Pineda" },
  ];
  assert.deepEqual(dedupeTeam(people), [
    { role: "booking", name: 'Joseph "JP" Pineda', email: "jp@agency.com", phone: "+13035550100", source: "https://agency.com/roster", links: ["https://www.linkedin.com/in/jp-pineda"] },
    { role: "booking", name: "Maria Pineda" },
  ]);
});

test("sameTeamName: initials, nicknames in quotes and accents match; different first names or surnames don't", () => {
  assert.ok(sameTeamName('Joseph "JP" Pineda', "JP Pineda"));
  assert.ok(sameTeamName('Joseph "JP" Pineda', "J. Pineda"));
  assert.ok(sameTeamName("JP Pineda", "J. Pineda"));
  assert.ok(sameTeamName("Dana Reyes", "dana reyes"));
  assert.ok(sameTeamName("Zoë Ålund", "Zoe Alund"));
  assert.ok(sameTeamName("Dana Reyes", "D Reyes"));
  assert.ok(!sameTeamName("Dana Reyes", "Maria Reyes"));
  assert.ok(!sameTeamName("Dana Reyes", "Dana Ortiz"));
  assert.ok(!sameTeamName("Joseph Pineda", "JP Pineda"), "JP is not an initial of Joseph without the nickname");
  assert.ok(!sameTeamName("Reyes", "Dana Reyes"), "one word isn't enough");
});

test("teamContactMatch: same email (any case), else the same name by sameTeamName", () => {
  const contacts = [{ id: "a", name: "Dana Reyes", emails: ["Dana@FRT.example"] }, { id: "b", name: 'Joseph "JP" Pineda', emails: [] }];
  assert.equal(teamContactMatch({ role: "booking", email: "dana@frt.example" }, contacts)?.id, "a");
  assert.equal(teamContactMatch({ role: "booking", name: "J. Pineda" }, contacts)?.id, "b");
  assert.equal(teamContactMatch({ role: "booking", name: "Maria Pineda", email: "maria@x.example" }, contacts), undefined);
});

test("groundTeam: a name no page says and a phone not on a page are dropped", () => {
  const pages = [{ url: "https://band.example/contact", text: "Booking: jo@agency.com", emails: [] }];
  const out = groundTeam([
    { name: "Invented Person", role: "management", company: null, email: null, phone: null, sourceUrl: null },
    { name: null, role: "booking", company: "Nowhere Agency", email: "jo@agency.com", phone: "303-555-0000", sourceUrl: "https://elsewhere.example/" },
  ], pages);
  assert.deepEqual(out, [{ role: "booking", email: "jo@agency.com", source: "https://band.example/contact" }]);
});

test("teamContactInput: an inbox gets a name from the act; the role and company make the title; a note says how they were found", () => {
  const T = "2026-11-11";
  assert.deepEqual(teamContactInput({ role: "management", email: "mgmt@band.com" }, "The Band", T), {
    name: "The Band manager", title: "Manager", emails: ["mgmt@band.com"], phones: [],
    notes: 'Found by "Find their team" for The Band on 2026-11-11. Manager for The Band: named in a Google search.',
  });
  const dana = teamContactInput({ role: "booking", name: "Dana Reyes", company: "Front Range Touring", phone: "+19705550142", source: "https://band.example/contact",
    links: ["https://www.linkedin.com/in/dana-reyes"], infoFrom: "https://frt.example/team" }, "The Band", T);
  assert.equal(dana.name, "Dana Reyes");
  assert.equal(dana.title, "Booking agent, Front Range Touring");
  assert.deepEqual(dana.phones, ["+19705550142"]);
  assert.deepEqual(dana.links, ["https://www.linkedin.com/in/dana-reyes"]);
  assert.deepEqual(dana.sources?.map((x) => x.url), ["https://band.example/contact", "https://frt.example/team"]);
  assert.equal(dana.notes, 'Found by "Find their team" for The Band on 2026-11-11. Booking agent for The Band at Front Range Touring: named on band.example (https://band.example/contact). The phone came from a search for them, on frt.example (https://frt.example/team).');
  assert.equal(teamContactInput({ role: "general", email: "hi@band.com" }, "The Band", T).name, "The Band");
  assert.match(teamNote({ role: "general", email: "hi@band.com" }, "The Band", T), /The Band's general inbox: named in a Google search\.$/);
});

test("teamContactPatch: only what the contact lacks, with a line added to the notes; nothing new is undefined", () => {
  const c = { emails: [], phones: [], notes: "Met at Larimer." };
  const p = { role: "booking" as const, name: "Heath B", email: "heath@agency.example", links: ["https://www.linkedin.com/in/heathb"], infoFrom: "https://agency.example/roster" };
  assert.deepEqual(teamContactPatch(p, c, "Brooke Alexx", "2026-11-11"), {
    emails: ["heath@agency.example"], links: ["https://www.linkedin.com/in/heathb"],
    notes: 'Met at Larimer.\n\nAdded email, links from "Find their team" for Brooke Alexx on 2026-11-11, on agency.example (https://agency.example/roster).',
  });
  assert.equal(teamContactPatch(p, { emails: ["heath@agency.example"], phones: [], links: p.links }, "Brooke Alexx", "2026-11-11"), undefined);
});

test("groundPerson: their own email, phone and LinkedIn from a page that names them, not a colleague's", () => {
  const sam = { role: "publicity" as const, name: "Sam Ortiz" };
  assert.deepEqual(groundPerson(sam, FAKE_TEAM.person.pages, FAKE_TEAM.person.sources), {
    email: "sam@ortizpr.example", phone: "+13035550177", infoFrom: "https://ortizpr.example/team",
    links: ["https://www.linkedin.com/in/sam-ortiz-pr", "https://ortizpr.example/team"],
  });
  // A page that doesn't name them adds nothing; someone with no name is never searched.
  assert.deepEqual(groundPerson({ role: "booking", name: "Dana Reyes" }, FAKE_TEAM.person.pages, []), {});
  assert.deepEqual(groundPerson({ role: "general", email: "x@y.example" }, FAKE_TEAM.person.pages, FAKE_TEAM.person.sources), {});
  // An email they already have isn't replaced.
  assert.equal(groundPerson({ ...sam, email: "sam@other.example" }, FAKE_TEAM.person.pages, []).email, undefined);
});

test("nameTokens and linkedInHrefs", () => {
  assert.deepEqual(nameTokens('Joseph "JP" Pineda'), ["joseph", "pineda"]);
  assert.deepEqual(nameTokens("Zoë Ålund"), ["zoe", "alund"]);
  assert.deepEqual(linkedInHrefs('<a href="http://linkedin.com/in/jo-x?trk=1">x</a><a href="https://www.linkedin.com/company/acme">y</a>'), ["https://linkedin.com/in/jo-x"]);
});
