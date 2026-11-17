/**
 * Roadie's platform switches, without a deploy (all server-only docs; tenancy plan phases 0 and 9):
 *
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=.secrets/<key>.json npx tsx scripts/platform-config.ts   # show everything
 *   ... platform-config.ts sign-up open | sign-up close      # platform/config.signUpOpen (also --sign-up=open|closed)
 *   ... platform-config.ts exempt <artistId>                 # platformArtists/{id}.exempt: no daily limits
 *   ... platform-config.ts unexempt <artistId>
 *   ... platform-config.ts suspend <artistId>                # refuse its calls, hide its fan page, drop it from its members' claims
 *   ... platform-config.ts unsuspend <artistId>
 *   ... platform-config.ts limit <name> <n>                  # platform/limits: roadieMessages webLookups transcriptions maps
 *                                                            #   publicMaps newArtistsPerDay newArtistsPerPerson
 *   ... platform-config.ts usage <artistId> [yyyy-mm-dd]     # that artist's counters (default: the last 7 days)
 *
 * Refuses to run without GCLOUD_PROJECT (so it can't silently hit the demo project).
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { PLATFORM_ARTISTS, membersOf, setArtistFlags } from "@/server/platform";
import { PLATFORM_CONFIG_DOC } from "@/server/signUpFlag";
import { DEFAULT_LIMITS, LIMITS_DOC, USAGE, readLimits, type Limits } from "@/server/usage";
import { syncClaims } from "@/server/session";

const USAGE_TEXT = "Usage: platform-config.ts [sign-up open|close | exempt|unexempt|suspend|unsuspend <artistId> | limit <name> <n> | usage <artistId> [date]]";

async function artistName(id: string) {
  const a = await firestore().collection("artists").doc(id).get();
  if (!a.exists) throw new Error(`No artist ${id}`);
  return String(a.get("name") ?? id);
}

async function show() {
  const fs = firestore();
  const cfg = (await fs.doc(PLATFORM_CONFIG_DOC).get()).data();
  console.log(`${process.env.GCLOUD_PROJECT}: sign-up is ${cfg?.signUpOpen === true ? "OPEN" : "closed (invite-only)"}`);
  const limits = await readLimits();
  console.log(`limits per artist per day: ${Object.entries(limits).map(([k, v]) => `${k}=${v}${v !== DEFAULT_LIMITS[k as keyof Limits] ? "*" : ""}`).join(" ")}`);
  const flagged = await fs.collection(PLATFORM_ARTISTS).get();
  for (const d of flagged.docs) {
    const f = d.data();
    console.log(`  ${d.id} (${await artistName(d.id).catch(() => "?")}): ${[f.exempt ? "exempt" : "", f.suspendedAt ? `suspended ${f.suspendedAt.toDate().toISOString()}` : ""].filter(Boolean).join(", ") || "no flags"}`);
  }
}

/** After a suspension changes: re-set every member's claims, so the browser stops (or starts again) reading the artist. */
async function resync(artistId: string) {
  const people = await membersOf(artistId);
  for (const p of people) await syncClaims(p.uid);
  console.log(`claims re-set for ${people.length} member(s)`);
}

async function main() {
  if (!process.env.GCLOUD_PROJECT) throw new Error("Set GCLOUD_PROJECT (e.g. roadie-prod-iab)");
  const args = process.argv.slice(2);
  const old = args.find((a) => a.startsWith("--sign-up="))?.slice("--sign-up=".length);
  const [cmd, a1, a2] = old ? ["sign-up", old === "closed" ? "close" : old] : args;
  const by = "scripts/platform-config";
  switch (cmd) {
    case undefined: break;
    case "sign-up": {
      if (a1 !== "open" && a1 !== "close") throw new Error(USAGE_TEXT);
      await firestore().doc(PLATFORM_CONFIG_DOC).set({ signUpOpen: a1 === "open", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      console.log(`sign-up ${a1 === "open" ? "opened" : "closed"}`);
      break;
    }
    case "exempt": case "unexempt": case "suspend": case "unsuspend": {
      if (!a1) throw new Error(USAGE_TEXT);
      const name = await artistName(a1);
      if (cmd === "exempt" || cmd === "unexempt") await setArtistFlags(a1, { exempt: cmd === "exempt" }, by);
      else { await setArtistFlags(a1, { suspended: cmd === "suspend" }, by); await resync(a1); }
      console.log(`${name} (${a1}): ${cmd} done`);
      break;
    }
    case "limit": {
      const n = Number(a2);
      if (!a1 || !(a1 in DEFAULT_LIMITS) || !Number.isInteger(n) || n < 0) throw new Error(`limit <${Object.keys(DEFAULT_LIMITS).join("|")}> <whole number>`);
      await firestore().doc(LIMITS_DOC).set({ [a1]: n, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      console.log(`${a1} = ${n}`);
      break;
    }
    case "usage": {
      if (!a1) throw new Error(USAGE_TEXT);
      const snap = await firestore().collection(USAGE).where("artistId", "==", a1).get();
      const rows = snap.docs.map((d) => d.data()).filter((d) => !a2 || d.date === a2).sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, a2 ? 1 : 7);
      for (const r of rows) console.log(`  ${r.date}: ${["roadieMessages", "webLookups", "transcriptions", "maps", "publicMaps"].map((k) => `${k}=${r[k] ?? 0}`).join(" ")}`);
      if (!rows.length) console.log("  no usage");
      return;
    }
    default: throw new Error(USAGE_TEXT);
  }
  await show();
}
main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
