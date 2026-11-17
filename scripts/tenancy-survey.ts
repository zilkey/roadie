/**
 * READ-ONLY. Did anyone besides the real artist get into Roadie while sign-up was open? (Tenancy plan, phase 0.)
 *
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=.secrets/<key>.json npx tsx scripts/tenancy-survey.ts [--artist <id>] [--admin <email>]
 *
 * Prints, as Markdown:
 *   1. every artist, oldest first, and the real one: --artist, else the oldest whose admins include --admin
 *      (default jeff@zilkey.com, the plan's Q6 default);
 *   2. users with a membership in any other artist;
 *   3. musicians whose email isn't one of the real artist's users;
 *   4. Auth accounts with no membership in the real artist (signed in, maybe never got further);
 *   5. Cloud Logging's `artists.signUp` events (needs Logs Viewer for the key);
 *   6. Drive permissions on the real artist's folder and the folders right under it, granted to addresses that aren't
 *      its users. Only with DRIVE_ACCESS_TOKEN set (an OAuth token that can read that folder); otherwise it says so.
 * Writes nothing anywhere.
 */
import { GoogleAuth } from "google-auth-library";
import type { Timestamp } from "firebase-admin/firestore";
import { adminAuth, firestore } from "@/server/admin";

type Membership = { artistId: string; role: string };
type Row = Record<string, unknown> & { id: string };
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const when = (t: unknown) => (t && typeof (t as Timestamp).toDate === "function" ? (t as Timestamp).toDate().toISOString().slice(0, 16).replace("T", " ") : "?");
const ms = (u: Row) => (Array.isArray(u.artists) ? (u.artists as Membership[]) : []);
const lc = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");

async function all(collection: string): Promise<Row[]> {
  return (await firestore().collection(collection).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function main() {
  const project = process.env.GCLOUD_PROJECT;
  if (!project) throw new Error("Set GCLOUD_PROJECT (e.g. roadie-prod-iab)");
  if (process.env.FIRESTORE_EMULATOR_HOST) console.error("(FIRESTORE_EMULATOR_HOST is set: reading the emulator)");
  const adminEmail = lc(arg("--admin") ?? "jeff@zilkey.com");
  const out: string[] = [`# Tenancy survey (${project}, ${new Date().toISOString()})`, ""];
  const say = (s = "") => out.push(s);

  const [artists, users, musicians] = await Promise.all([all("artists"), all("users"), all("musicians")]);
  artists.sort((a, b) => ((a.createdAt as Timestamp)?.toMillis?.() ?? 0) - ((b.createdAt as Timestamp)?.toMillis?.() ?? 0));
  const byId = new Map(users.map((u) => [u.id, u]));
  const admins = (artistId: string) => users.filter((u) => !u.deletedAt && ms(u).some((m) => m.artistId === artistId && m.role === "admin"));
  const members = (artistId: string) => users.filter((u) => ms(u).some((m) => m.artistId === artistId));

  // 1. artists
  say(`## 1. Artists (${artists.length}), oldest first`);
  say("| id | slug | name | created | created by | admins | users | deleted |");
  say("|---|---|---|---|---|---|---|---|");
  for (const a of artists) {
    const by = byId.get(String(a.createdBy));
    say(`| ${a.id} | ${a.slug} | ${a.name} | ${when(a.createdAt)} | ${by ? lc(by.email) : a.createdBy} | ${admins(a.id).map((u) => lc(u.email)).join(", ")} | ${members(a.id).length} | ${a.deletedAt ? when(a.deletedAt) : ""} |`);
  }
  const real = arg("--artist") ? artists.find((a) => a.id === arg("--artist")) : artists.find((a) => !a.deletedAt && admins(a.id).some((u) => lc(u.email) === adminEmail));
  if (!real) throw new Error(`No real artist: none matches ${arg("--artist") ? `--artist ${arg("--artist")}` : `an admin ${adminEmail}`}`);
  say("");
  say(`**Real artist (Q6 default: oldest with admin ${adminEmail}): \`${real.id}\` (${real.name}, /artists/${real.slug})**`);
  const others = artists.filter((a) => a.id !== real.id);
  say(others.length ? `Other artists: ${others.length}.` : "No other artists.");
  say("");

  // 2. users in another artist
  const realUsers = members(real.id);
  const realEmails = new Set(realUsers.map((u) => lc(u.email)));
  const elsewhere = users.filter((u) => ms(u).some((m) => m.artistId !== real.id));
  say(`## 2. Users with a membership in another artist (${elsewhere.length})`);
  for (const u of elsewhere) {
    const list = ms(u).map((m) => `${m.artistId === real.id ? "REAL" : m.artistId}:${m.role}`).join(", ");
    say(`- ${lc(u.email)} (uid ${u.id}, ${u.name ?? ""}) → ${list}${realEmails.has(lc(u.email)) ? " — also in the real artist" : ""}${u.deletedAt ? " — removed" : ""}`);
  }
  say("");
  say(`Real artist's users (${realUsers.length}): ${realUsers.map((u) => `${lc(u.email)}${ms(u).find((m) => m.artistId === real.id)?.role === "admin" ? " (admin)" : ""}${u.deletedAt ? " (removed)" : ""}`).join(", ")}`);
  const noMembership = users.filter((u) => !ms(u).length);
  if (noMembership.length) say(`Users docs with no membership at all (${noMembership.length}): ${noMembership.map((u) => `${lc(u.email)} (uid ${u.id})`).join(", ")}`);
  say("");

  // 3. musicians
  const strangeMusicians = musicians.filter((m) => !m.deletedAt && lc(m.email) && !realEmails.has(lc(m.email)));
  const linkedElsewhere = musicians.filter((m) => m.userId && !realUsers.some((u) => u.id === m.userId));
  say(`## 3. Musicians (${musicians.length} in all) whose email isn't a real-artist user's (${strangeMusicians.length})`);
  for (const m of strangeMusicians) say(`- ${m.name} <${lc(m.email)}> (id ${m.id}, created ${when(m.createdAt)} by ${lc(byId.get(String(m.createdBy))?.email) || m.createdBy})${m.userId ? `, linked to uid ${m.userId}` : ""}`);
  if (linkedElsewhere.length) {
    say("");
    say(`Musicians linked to a login outside the real artist (${linkedElsewhere.length}):`);
    for (const m of linkedElsewhere) say(`- ${m.name} (id ${m.id}) → uid ${m.userId} ${lc(byId.get(String(m.userId))?.email)}`);
  }
  say("");

  // 4. Auth accounts
  const accounts: { uid: string; email: string; created: string; last: string }[] = [];
  let token: string | undefined;
  do {
    const page = await adminAuth().listUsers(1000, token);
    for (const u of page.users) accounts.push({ uid: u.uid, email: lc(u.email), created: u.metadata.creationTime, last: u.metadata.lastSignInTime ?? "" });
    token = page.pageToken;
  } while (token);
  const realUids = new Set(realUsers.map((u) => u.id));
  const outsiders = accounts.filter((a) => !realUids.has(a.uid));
  say(`## 4. Auth accounts (${accounts.length}) not in the real artist (${outsiders.length})`);
  for (const a of outsiders) say(`- ${a.email || "(no email)"} (uid ${a.uid}) created ${a.created}, last sign-in ${a.last || "never"}${byId.has(a.uid) ? "" : ", no users doc"}`);
  say("");

  // 5. Cloud Logging
  say("## 5. Cloud Logging: artists.signUp events");
  try {
    const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/logging.read"] }).getClient();
    const entries: { timestamp: string; jsonPayload?: Record<string, unknown> }[] = [];
    let pageToken: string | undefined;
    do {
      const r = await client.request<{ entries?: typeof entries; nextPageToken?: string }>({
        url: "https://logging.googleapis.com/v2/entries:list", method: "POST",
        data: { resourceNames: [`projects/${project}`], filter: `jsonPayload.event="artists.signUp" AND timestamp>="2026-01-01T00:00:00Z"`, orderBy: "timestamp asc", pageSize: 1000, pageToken },
      });
      entries.push(...(r.data.entries ?? []));
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    say(`${entries.length} event(s) (Cloud Logging keeps 30 days by default, so older ones are gone).`);
    for (const e of entries) {
      const p = e.jsonPayload ?? {};
      say(`- ${e.timestamp} ok=${p.ok} uid=${p.uid} ${lc(byId.get(String(p.uid))?.email)} ${p.artistId ? `artist=${p.artistId} slug=${p.slug}` : `error=${p.error}`}`);
    }
  } catch (e) {
    say(`Couldn't read logs: ${e instanceof Error ? e.message : e}`);
  }
  say("");

  // 6. Drive
  say(`## 6. Drive permissions on the real artist's folder (${real.driveFolderId || "none set"})`);
  const driveToken = process.env.DRIVE_ACCESS_TOKEN;
  if (!real.driveFolderId) say("No band folder set.");
  else if (!driveToken) say("Skipped: set DRIVE_ACCESS_TOKEN to list them here.");
  else {
    const g = async <T>(path: string) => {
      const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { authorization: `Bearer ${driveToken}` } });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return (await r.json()) as T;
    };
    type Perm = { emailAddress?: string; role: string; type: string };
    const folder = String(real.driveFolderId);
    const kids = await g<{ files: { id: string; name: string }[] }>(`files?q=${encodeURIComponent(`'${folder}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    for (const f of [{ id: folder, name: "(band folder)" }, ...kids.files]) {
      const p = await g<{ permissions: Perm[] }>(`files/${f.id}/permissions?fields=permissions(emailAddress,role,type)&supportsAllDrives=true`);
      const odd = p.permissions.filter((x) => x.type !== "user" || !realEmails.has(lc(x.emailAddress)));
      say(`- ${f.name} (${f.id}): ${odd.length ? odd.map((x) => `${x.type}:${lc(x.emailAddress) || "-"}:${x.role}`).join(", ") : "only the artist's users"}`);
    }
  }

  console.log(out.join("\n"));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
