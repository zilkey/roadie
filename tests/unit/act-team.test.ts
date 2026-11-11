// "Find their team" on an act's Contacts card: the pure parts, no emulator, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emailsIn, FAKE_TEAM, groundTeam, roleFromEmail, roleNear, teamPageLinks } from "@/server/assistant/actTeam";
import { teamContactInput } from "@/lib/acts";

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
    { role: "management", email: "mgmt@abrothersfountain.example", source: "https://abrothersfountain.example/contact" },
    { role: "publicity", name: "Sam Ortiz" },
    { role: "general", email: "hello@abrothersfountain.example", source: "https://abrothersfountain.example/contact" },
  ]);
});

test("groundTeam: a name no page says and a phone not on a page are dropped", () => {
  const pages = [{ url: "https://band.example/contact", text: "Booking: jo@agency.com", emails: [] }];
  const out = groundTeam([
    { name: "Invented Person", role: "management", company: null, email: null, phone: null, sourceUrl: null },
    { name: null, role: "booking", company: "Nowhere Agency", email: "jo@agency.com", phone: "303-555-0000", sourceUrl: "https://elsewhere.example/" },
  ], pages);
  assert.deepEqual(out, [{ role: "booking", email: "jo@agency.com", source: "https://band.example/contact" }]);
});

test("teamContactInput: an inbox gets a name from the act; the role and company make the title", () => {
  assert.deepEqual(teamContactInput({ role: "management", email: "mgmt@band.com" }, "The Band"), { name: "The Band manager", title: "Manager", emails: ["mgmt@band.com"], phones: [] });
  const dana = teamContactInput({ role: "booking", name: "Dana Reyes", company: "Front Range Touring", phone: "+19705550142", source: "https://band.example/contact" }, "The Band");
  assert.equal(dana.name, "Dana Reyes");
  assert.equal(dana.title, "Booking agent, Front Range Touring");
  assert.deepEqual(dana.phones, ["+19705550142"]);
  assert.equal(dana.sources?.[0].url, "https://band.example/contact");
  assert.deepEqual(teamContactInput({ role: "general", email: "hi@band.com" }, "The Band"), { name: "The Band", emails: ["hi@band.com"], phones: [] });
});
