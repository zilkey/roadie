// Releases: pure helpers, nav and routes (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { navFor } from "@/lib/nav";
import { DEFAULT_SECTION_ORDER, defaultHidden } from "@/schema/sections";
import { resolveRoute, routeForPath } from "@/lib/routes";
import { guessReleaseKind, guessVersion, latestMix, mixLabel, sidesFor, sidesOf, spentByTrack, trackProgress } from "@/lib/releases";

test("spentByTrack: each track in order (nothing spent reads 0), then Whole release; removed lines skipped, a gone track's lines count as whole release", () => {
  const tracks = [{ id: "t2", position: 2, title: "Low Light" }, { id: "t1", position: 1, title: "Opener" }];
  const rows = spentByTrack(tracks, [
    { amount: 30000, releaseTrackId: "t2" }, { amount: 5000, releaseTrackId: "t2" }, { amount: 180000 },
    { amount: 999, releaseTrackId: "t1", deletedAt: "x" }, { amount: 700, releaseTrackId: "gone" },
  ]);
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.out]), [["t1", "1 · Opener", 0], ["t2", "2 · Low Light", 35000], ["release", "Whole release", 180700]]);
  assert.deepEqual(spentByTrack(tracks, [{ amount: 100, releaseTrackId: "t1" }]).map((r) => r.key), ["t1", "t2"]);
});

test("pure helpers: sides, progress, versions, kinds, the latest mix", () => {
  assert.deepEqual(sidesFor(4, []), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(sidesFor(5, [2]), ["A", "A", "B", "B", "B"]);
  assert.deepEqual(sidesFor(5, [3, 1]), ["A", "B", "B", "C", "C"]);
  assert.deepEqual(sidesFor(3, [0, 7]), [undefined, undefined, undefined]);
  const groups = sidesOf([{ side: "A", lengthSec: 10 }, { side: "A", lengthSec: 20 }, { side: "B", lengthSec: 5 }]);
  assert.deepEqual(groups.map((g) => [g.side, g.tracks.length, g.lengthSec]), [["A", 2, 30], ["B", 1, 5]]);
  assert.deepEqual(trackProgress([{ status: "tracking" }, { status: "overdubs" }, { status: "mixing" }, { status: "mixed" }, { status: "mastered" }]), { total: 5, tracked: 4, mixed: 2, mastered: 1 });
  assert.equal(guessVersion("Low Light v4.wav"), 4);
  assert.equal(guessVersion("mix_v12_final.wav"), 12);
  assert.equal(guessVersion("Low Light rough.wav"), undefined);
  assert.equal(guessReleaseKind("Low Light master 44k.wav", "audio/wav", true), "master");
  assert.equal(guessReleaseKind("Low Light v2.wav", "audio/wav", true), "mix");
  assert.equal(guessReleaseKind("Stems v4 (12 files).zip", "application/zip", true), "stems");
  assert.equal(guessReleaseKind("Cover final 3000px.png", "image/png"), "artwork");
  assert.equal(guessReleaseKind("Liner notes", "application/vnd.google-apps.document"), "liner");
  assert.equal(guessReleaseKind("One-sheet", "application/vnd.google-apps.document"), "promo");
  assert.equal(guessReleaseKind("Full release master.wav", "audio/wav"), "master");
  const files = [
    { id: "a", kind: "mix", title: "v1", releaseTrackId: "t", version: 1, notes: [{}, {}] },
    { id: "b", kind: "mix", title: "v3", releaseTrackId: "t", version: 3, approved: true },
    { id: "c", kind: "master", title: "m", releaseTrackId: "t", version: 9 },
    { id: "d", kind: "mix", title: "other", releaseTrackId: "u", version: 7 },
  ];
  assert.equal(latestMix(files, "t")?.id, "b");
  assert.equal(mixLabel(latestMix(files, "t")), "v3 · approved");
  assert.equal(mixLabel(files[0]), "v1 · 2 notes");
  assert.equal(mixLabel(undefined), "—");
});

test("nav and routes: Releases sits after Songs for admins only and starts in More; the release routes resolve", () => {
  const on = navFor("admin", [...DEFAULT_SECTION_ORDER], { fans: true }).map((n) => n.key);
  assert.equal(on[on.indexOf("songs") + 1], "releases");
  assert.ok(!navFor("member", [...DEFAULT_SECTION_ORDER]).some((n) => n.key === "releases"));
  assert.ok(defaultHidden("admin").includes("releases"));
  assert.equal(resolveRoute("release", { id: "a1" }, "band")?.href, "/artists/band/releases/a1");
  assert.equal(resolveRoute("releaseTrack", { id: "a1", trackId: "t1" })?.href, "/releases/a1/tracks/t1");
  assert.equal(resolveRoute("releaseMoney", { id: "a1" })?.href, "/releases/a1?tab=money");
  assert.deepEqual(routeForPath("/artists/band/releases/new"), { route: "newRelease", params: {}, artist: "band" });
  assert.deepEqual(routeForPath("/artists/band/releases/a1/tracks/t1"), { route: "releaseTrack", params: { id: "a1", trackId: "t1" }, artist: "band" });
  assert.equal(routeForPath("/releases/a1")?.route, "release");
});
