import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from "firebase/firestore";

let env: RulesTestEnvironment;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-band-tracker",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const live = { deletedAt: null };
    for (const c of ["users", "musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals", "venues", "contacts", "promoters",
      "festivals", "editions", "pitches", "emailTemplates", "checklistTemplates", "showDeals", "statSnapshots", "history", "mcpTokens"]) {
      await setDoc(doc(d, c, "x"), { ...live, n: 1 });
    }
    await setDoc(doc(d, "pitches/x/comments/c1"), { ...live });
    await setDoc(doc(d, "pitches/x/activity/a1"), { ...live });
    await setDoc(doc(d, "songs/gone"), { deletedAt: new Date() });
    await setDoc(doc(d, "availability/asked"), { ...live, askedMusicianIds: ["m-david"] });
    await setDoc(doc(d, "availability/other"), { ...live, askedMusicianIds: ["m-eric"] });
    await setDoc(doc(d, "ledger/mine"), { ...live, kind: "payout", payeeUserId: "david" });
    await setDoc(doc(d, "ledger/theirs"), { ...live, kind: "payout", payeeUserId: "eric" });
    await setDoc(doc(d, "ledger/income"), { ...live, kind: "income" });
    await setDoc(doc(d, "expenses/mine"), { ...live, userId: "david" });
    await setDoc(doc(d, "expenses/theirs"), { ...live, userId: "eric" });
  });
});
after(async () => { await env.cleanup(); });

const admin = () => env.authenticatedContext("jeff", { role: "admin" }).firestore();
const david = () => env.authenticatedContext("david", { role: "member", musicianId: "m-david" }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const noRole = () => env.authenticatedContext("nobody", {}).firestore();

const ALL = ["users", "musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals", "venues", "contacts", "promoters",
  "festivals", "editions", "pitches", "emailTemplates", "checklistTemplates", "showDeals", "statSnapshots", "history", "mcpTokens"];
const MEMBER_READS = ["musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals"];

test("admin reads everything, including sub-collections", async () => {
  for (const c of ALL) await assertSucceeds(getDoc(doc(admin(), c, "x")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/comments/c1")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/activity/a1")));
  for (const p of ["availability/asked", "ledger/income", "expenses/theirs"]) await assertSucceeds(getDoc(doc(admin(), p)));
});

test("members read the band collections but not booking, deals, money, users", async () => {
  for (const c of ALL) {
    const r = getDoc(doc(david(), c, "x"));
    await (MEMBER_READS.includes(c) ? assertSucceeds(r) : assertFails(r));
  }
  await assertFails(getDoc(doc(david(), "pitches/x/comments/c1")));
  await assertSucceeds(getDocs(query(collection(david(), "songs"), where("deletedAt", "==", null))));
});

test("members cannot read soft-deleted shared docs", async () => {
  await assertFails(getDoc(doc(david(), "songs/gone")));
  await assertSucceeds(getDoc(doc(admin(), "songs/gone")));
});

test("availability: members read only where they are asked", async () => {
  await assertSucceeds(getDoc(doc(david(), "availability/asked")));
  await assertFails(getDoc(doc(david(), "availability/other")));
});

test("ledger: members read only their own payouts", async () => {
  await assertSucceeds(getDoc(doc(david(), "ledger/mine")));
  await assertFails(getDoc(doc(david(), "ledger/theirs")));
  await assertFails(getDoc(doc(david(), "ledger/income")));
});

test("expenses: members read only their own", async () => {
  await assertSucceeds(getDoc(doc(david(), "expenses/mine")));
  await assertFails(getDoc(doc(david(), "expenses/theirs")));
});

test("signed-out and role-less users read nothing", async () => {
  for (const c of ["musicians", "shows", "venues", "users"]) {
    await assertFails(getDoc(doc(anon(), c, "x")));
    await assertFails(getDoc(doc(noRole(), c, "x")));
  }
});

test("ALL client writes are denied, even for admins", async () => {
  for (const db of [admin(), david(), anon()]) {
    await assertFails(setDoc(doc(db, "songs", "new"), { title: "x" }));
    await assertFails(updateDoc(doc(db, "songs", "x"), { n: 2 }));
    await assertFails(deleteDoc(doc(db, "songs", "x")));
    await assertFails(setDoc(doc(db, "expenses", "new"), { userId: "david" }));
    await assertFails(setDoc(doc(db, "pitches/x/comments/new"), { body: "x" }));
    await assertFails(setDoc(doc(db, "unlisted", "new"), { a: 1 }));
  }
});
