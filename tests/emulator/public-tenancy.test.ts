import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execute } from "@/server/commands/dispatch";
import { answerByToken, hashToken, newToken, viewByToken } from "@/server/availability";
import { publicPlot } from "@/server/stagePlotShare";
import { signup } from "@/server/fans";
import { firestore } from "@/server/admin";
import { artistCtx, importCtx } from "@/server/ctx";
import { db } from "@/server/db";
import { resetEmulators, makeUser, makeArtist, SYS } from "./helpers";

// Tenancy plan D3, routes table: a public link reaches only its own artist. The artist comes from the record the link points at,
// after its token is checked (availability asks, stage plots), or from the slug (fan page).

beforeEach(resetEmulators);
async function two() {
  await makeArtist("Alpha", "alpha", "A");
  await makeArtist("Beta", "beta", "B");
  const a = await makeUser("a@x.example", "admin", { artistId: "A" });
  const b = await makeUser("b@x.example", "admin", { artistId: "B" });
  return { a, b };
}

test("availability links: the ask's own artist, after the token check; a token for another ask is refused", async () => {
  await two();
  const mA = (await db.create(importCtx("A"), "musicians", { name: "Al", instruments: ["bass"], active: true })).id;
  const mB = (await db.create(importCtx("B"), "musicians", { name: "Bo", instruments: ["keys"], active: true })).id;
  const tA = newToken(), tB = newToken();
  const askA = (await db.create(importCtx("A"), "availability", { date: "2027-06-01", label: "A gig", askedMusicianIds: [mA], responses: {}, linkTokens: { [mA]: hashToken(tA) } })).id;
  const askB = (await db.create(importCtx("B"), "availability", { date: "2027-06-01", label: "B gig", askedMusicianIds: [mB], responses: {}, linkTokens: { [mB]: hashToken(tB) } })).id;
  assert.equal((await viewByToken(askB, mB, tB)).musicianName, "Bo");
  await answerByToken(askB, mB, tB, "yes");
  assert.equal((await db.get(SYS, "availability", askB))!.responses[mB].answer, "yes");
  // B's token on A's ask, A's musician on B's ask: the same invalid_link as any bad link.
  await assert.rejects(answerByToken(askA, mB, tB, "yes"), { code: "invalid_link" });
  await assert.rejects(viewByToken(askB, mA, tA), { code: "invalid_link" });
  assert.deepEqual((await db.get(SYS, "availability", askA))!.responses, {});
  // The ask's History is B's.
  assert.equal((await db.history(SYS, "availability", askB))[0].artistId, "B");
});

test("stage plot links: the plot's own artist; an older token doc with no artist still works", async () => {
  const { b } = await two();
  const bCtx = artistCtx({ uid: b.uid, role: "admin", artistId: "B", via: "app" });
  const plot = (await execute(bCtx, "stagePlots.create", { name: "Trio" })).result as { id: string };
  const { url } = (await execute(bCtx, "stagePlots.shareLink", { id: plot.id })).result as { url: string };
  const token = url.split("/").pop()!;
  const got = await publicPlot(plot.id, token);
  assert.equal(got.ctx.artistId, "B");
  assert.equal(got.plot.id, plot.id);
  await assert.rejects(publicPlot(plot.id, newToken()), { code: "invalid_link" });
  // A token saved before phase 4 names no artist: the plot's own is used.
  await firestore().doc(`stagePlotTokens/${plot.id}`).set({ token });
  assert.equal((await publicPlot(plot.id, token)).ctx.artistId, "B");
});

test("fan page: a signup lands in the slug's artist only", async () => {
  await two();
  for (const id of ["A", "B"]) await db.update(SYS, "artists", id, { features: { fans: true } });
  await signup("beta", { email: "fan@x.example", page: "https://x.example/beta" });
  const fans = await db.list(SYS, "fans");
  assert.deepEqual(fans.map((f) => f.artistId), ["B"]);
  assert.equal((await db.history(SYS, "fans", fans[0].id))[0].artistId, "B");
});
