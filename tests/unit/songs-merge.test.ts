// Covers the song-merge reference counts and the Roadie confirmation policy for songs.merge (no database).

import { test } from "node:test";
import assert from "node:assert/strict";
import { needsConfirm, summarize } from "@/server/assistant/policy";
import { defaultKeep, refsLabel, songRefs } from "@/lib/music";

test("refs: counts, label and the default keep", () => {
  const src = {
    files: [{ songId: "a" }, { songId: "a" }, { songId: "b" }],
    lists: [{ items: [{ songId: "a", alts: [{ songId: "b" }] }, { songId: "a" }] }, { items: [{ songId: "b" }] }],
    rehearsals: [{ songs: [{ songId: "a" }] }],
    tracks: [{ songId: "a", releaseId: "r" }, { songId: "a", releaseId: "r" }],
  };
  assert.deepEqual(songRefs("a", src), { files: 2, setlists: 1, rehearsals: 1, releases: 1 });
  assert.equal(refsLabel(songRefs("a", src)), "2 files · 1 setlist · 1 rehearsal · 1 release");
  assert.equal(refsLabel(songRefs("zzz", src)), "Nothing attached");
  assert.equal(defaultKeep([{ id: "b" }, { id: "a" }], (id) => songRefs(id, src)).id, "a");
  assert.equal(defaultKeep([{ id: "x" }, { id: "y" }], (id) => songRefs(id, src)).id, "x", "a tie keeps the first");
});

test("Roadie: songs.merge always asks, and the card lists what moves", () => {
  assert.equal(needsConfirm("songs.merge", { keepId: "a", mergeIds: ["b"] }), true);
  const line = summarize("songs.merge", { keepId: "a", mergeIds: ["b"] }, undefined, {
    keep: { title: "The Bliss", status: "active" },
    others: [{ title: "The Bliss", status: "learning", refs: { files: 3, setlists: 2, rehearsals: 1, releases: 0 } }],
  });
  assert.match(line, /Merge The Bliss \(learning\) into The Bliss \(playing\)\. Moving: 3 files · 2 setlists · 1 rehearsal\./);
});
