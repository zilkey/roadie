import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc } from "firebase/firestore";

let env: RulesTestEnvironment;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");

before(async () => {
  env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT ?? "demo-band-tracker", firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "assistantThreads/t1"), { ownerUid: "rudy" });
    await setDoc(doc(d, "assistantThreads/t1/messages/m1"), { role: "user", text: "hi" });
    await setDoc(doc(d, "assistantThreads/t2"), { ownerUid: "nora" });
    await setDoc(doc(d, "assistantThreads/t2/messages/m1"), { role: "user", text: "secret" });
  });
});
after(async () => { await env.cleanup(); });

const rudy = () => env.authenticatedContext("rudy", { artists: { a: "admin" } }).firestore();
const hugo = () => env.authenticatedContext("hugo", { artists: { a: "member" } }).firestore();
const demoted = () => env.authenticatedContext("rudy", { artists: { a: "member" } }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("assistant threads: owner admin reads own thread and messages", async () => {
  await assertSucceeds(getDoc(doc(rudy(), "assistantThreads/t1")));
  await assertSucceeds(getDoc(doc(rudy(), "assistantThreads/t1/messages/m1")));
  await assertSucceeds(getDocs(collection(rudy(), "assistantThreads/t1/messages")));
});

test("assistant threads: other admins, members and signed-out users read nothing", async () => {
  await assertFails(getDoc(doc(rudy(), "assistantThreads/t2")));
  await assertFails(getDoc(doc(rudy(), "assistantThreads/t2/messages/m1")));
  await assertFails(getDocs(collection(rudy(), "assistantThreads/t2/messages")));
  await assertFails(getDoc(doc(hugo(), "assistantThreads/t1")));
  await assertFails(getDoc(doc(demoted(), "assistantThreads/t1/messages/m1")));
  await assertFails(getDoc(doc(anon(), "assistantThreads/t1")));
});

test("assistant threads: all client writes are denied, even for the owner", async () => {
  await assertFails(setDoc(doc(rudy(), "assistantThreads/new"), { ownerUid: "rudy" }));
  await assertFails(updateDoc(doc(rudy(), "assistantThreads/t1"), { lastActiveAt: 1 }));
  await assertFails(deleteDoc(doc(rudy(), "assistantThreads/t1")));
  await assertFails(addDoc(collection(rudy(), "assistantThreads/t1/messages"), { role: "user", text: "x" }));
  await assertFails(updateDoc(doc(rudy(), "assistantThreads/t1/messages/m1"), { text: "edited" }));
});
