// "Add a pitch" on a thread's "This email covers" card: which other pitches come first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverSuggestions, type CoverData, type CoverPitch } from "@/lib/coverSuggestions";

const d: CoverData = {
  venues: [
    { id: "heron", contactIds: ["desmond"], promoterIds: ["frp"] },
    { id: "pine", contactIds: ["rosa"], promoterIds: [] },
    { id: "barn", contactIds: [], promoterIds: [] },
    { id: "mill", contactIds: [], promoterIds: [] },
    { id: "zed", contactIds: [], promoterIds: [] },
  ],
  promoters: [{ id: "frp", name: "Front Range Presents", contactIds: ["desmond"], venueIds: ["barn"] }],
  festivals: [{ id: "folks", contactIds: [], promoterId: "frp" }],
  editions: [{ id: "folks27", festivalId: "folks" }],
  contacts: [{ id: "desmond", name: "Desmond Webb", emails: ["Desmond@heron.example"] }, { id: "rosa", name: "Rosa Jackson", emails: ["rosa@pine.example"] }],
  campaigns: [{ id: "fall", name: "Fall Breweries" }],
};
const pitch = (id: string, kind: string, name: string, campaignId?: string): CoverPitch => ({ id, status: "pitched", target: { kind, id, name }, campaignId });
const label = () => "Pitched";

test("someone on the email, then the same promoter, then the same campaign; the rest stay at the bottom", () => {
  const on = [pitch("mill", "venue", "Mill", "fall")];
  const candidates = [pitch("zed", "venue", "Zed"), pitch("pine", "venue", "Pine", "fall"), pitch("barn", "venue", "Barn"), pitch("heron", "venue", "Heron")];
  const r = coverSuggestions({ target: { kind: "promoter", id: "frp", name: "Front Range Presents" }, participants: ["desmond@heron.example"] }, on, candidates, d, label);
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(by.heron.sub, "Desmond Webb is on this email · Same promoter: Front Range Presents · Pitched");
  assert.equal(by.barn.sub, "Same promoter: Front Range Presents · Pitched"); // listed on the promoter's own venueIds
  assert.equal(by.pine.sub, "Same campaign: Fall Breweries · Pitched");
  assert.equal(by.zed.sub, "Pitched");
  assert.deepEqual([...r].sort((a, b) => b.rank - a.rank).map((x) => x.id), ["heron", "barn", "pine", "zed"]);
});

test("a festival year shares its festival's promoter; the promoter's own pitch says so", () => {
  const r = coverSuggestions({ target: { kind: "venue", id: "heron", name: "Heron" }, participants: [] }, [],
    [pitch("folks27", "edition", "Folks 2027"), pitch("frp", "promoter", "Front Range Presents")], d, label);
  assert.equal(r[0].sub, "Same promoter: Front Range Presents · Pitched");
  assert.equal(r[1].sub, "The promoter · Pitched");
});
