/**
 * Seeds the running emulators with the PLAN's people plus Front Range sample data.
 * All writes go through src/server/db.ts with via 'import'. Idempotent: skips if already seeded.
 *   npm run seed            (emulators must be running)
 *   npm run seed -- --reset (wipe emulator data first)
 *   npm run seed -- --people (only people, the artist and templates: no demo venues, shows, songs or money;
 *                             for real data from `npm run import:booking`)
 */
import { adminAuth } from "../src/server/admin";
import { db } from "../src/server/db";
import { importCtx } from "../src/server/ctx";
import { syncClaims } from "../src/server/session";
import { slugForArtist } from "../src/schema/artists";
import { DEV_PEOPLE } from "../src/lib/dev-people";
import { DEFAULT_CHECKLIST_TEMPLATES } from "../src/lib/shows";

const project = "demo-band-tracker";
const fsHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9319";

async function reset() {
  await fetch(`http://${fsHost}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${project}/accounts`, { method: "DELETE" });
}

async function main() {
  if (process.argv.includes("--reset")) await reset();
  if ((await db.list("artists")).length) { console.log("Already seeded (use --reset to start over)."); return; }
  const ctx = importCtx("seed");
  const create = async (path: string, doc: Record<string, unknown>, id?: string) => (await db.create(ctx, path, doc, id ? { id } : undefined)).id;
  const src = (url: string) => [{ url, checkedAt: "2026-10-20", note: "Venue website" }];

  // --- people ---
  const mid: Record<string, string> = {};
  for (const p of DEV_PEOPLE) {
    mid[p.key] = await create("musicians", { name: p.name, instruments: p.instruments, email: p.email, active: true });
  }
  mid.sam = await create("musicians", { name: "Sam", instruments: ["drums"], phone: "+13035550142", payHandle: "@sam-drums", active: true });

  const gear = (label: string, who?: string) => ({ label, ...(who ? { musicianId: mid[who] } : {}) });
  const artist = await create("artists", {
    name: "Ingrid Avison Band",
    slug: slugForArtist("Ingrid Avison Band"),
    configurations: [
      { id: "full-band", name: "Full band", billingName: "Ingrid Avison Band", musicianIds: ["ingrid", "jeff", "david", "eric", "emma"].map((k) => mid[k]),
        gear: [gear("Keys rig", "jeff"), gear("Bass rig", "david"), gear("Snare, cymbals, pedal", "eric"), gear("Violin + pedalboard", "emma")] },
      { id: "trio", name: "Trio", billingName: "Ingrid Avison Trio", musicianIds: ["ingrid", "jeff", "david"].map((k) => mid[k]),
        gear: [gear("Keys rig", "jeff"), gear("Bass rig", "david")] },
      { id: "duo", name: "Duo", billingName: "Ingrid Avison Duo", musicianIds: ["ingrid", "jeff"].map((k) => mid[k]), gear: [gear("Keys rig", "jeff")] },
      { id: "ingrid-solo", name: "Ingrid solo", billingName: "Ingrid Avison", musicianIds: [mid.ingrid], gear: [gear("Acoustic guitar", "ingrid")] },
    ],
    soundGear: {
      bandProvided: [gear("PA speakers + stands", "jeff"), gear("Mixer + snake", "jeff"), gear("Monitor wedges", "eric")],
      venueProvided: [gear("In-ear rack", "jeff")],
    },
    links: { spotify: "https://open.spotify.com/artist/example", instagram: "https://instagram.com/ingridavison", website: "https://ingridavison.example" },
    driveFolderId: "fake-band-folder",
  });

  // Every seeded person belongs to the artist, with their role there.
  const uid: Record<string, string> = {};
  for (const p of DEV_PEOPLE) {
    const u = await adminAuth().createUser({ email: p.email, displayName: p.name, emailVerified: true });
    uid[p.key] = u.uid;
    await create("users", { email: p.email, name: p.name, artists: [{ artistId: artist, role: p.role }], mcpAccess: p.key === "jeff", musicianId: mid[p.key] }, u.uid);
    await db.update(ctx, "musicians", mid[p.key], { userId: u.uid });
    await syncClaims(u.uid);
  }

  if (process.argv.includes("--people")) {
    await seedTemplates(create);
    console.log("Seeded: 6 musicians, 5 users, artist with 4 configurations, email and checklist templates (no demo data).");
    return;
  }

  // --- booking data ---
  const haylee = await create("contacts", { name: "Haylee Jackson", title: "Talent buyer", emails: ["haylee@lostlake.example"], phones: ["+13035550101"], instagram: "hayleebooks", sources: src("https://lostlake.example/contact") });
  const marcus = await create("contacts", { name: "Marcus Webb", title: "Booking manager", emails: ["marcus@foxtheatre.example"], phones: [], sources: src("https://foxtheatre.example/booking") });
  const dana = await create("contacts", { name: "Dana Ortiz", title: "Programming director", emails: ["dana@dairyarts.example"], phones: ["+13035550177"] });
  const priya = await create("contacts", { name: "Priya Shah", title: "Festival producer", emails: ["priya@umsfest.example"], phones: [] });
  const promo1 = await create("promoters", { name: "Front Range Presents", kind: "promoter", website: "https://frontrangepresents.example", contactIds: [marcus], venueIds: [], howToPitch: "Email Marcus with live video and two dates.", sources: src("https://frontrangepresents.example") });
  const promo2 = await create("promoters", { name: "Dairy Arts Center", kind: "nonprofit", contactIds: [dana], venueIds: [], howToPitch: "Online submission form, twice a year." });
  const v = (name: string, type: string, city: string, region: string, extra: Record<string, unknown> = {}) =>
    create("venues", { name, type, address: { city, state: "CO" }, region, contactIds: [], promoterIds: [], ...extra });
  const hidive = await v("Hi-Dive", "bar", "Denver", "denver", { address: { street: "7 S Broadway", city: "Denver", state: "CO" }, capacity: 250, ages: "21", sound: { provider: "venueProvided", notes: "House engineer" } });
  const lostlake = await v("Lost Lake Lounge", "club", "Denver", "denver", { address: { street: "3602 E Colfax Ave", city: "Denver", state: "CO" }, capacity: 300, ages: "21", contactIds: [haylee], sources: src("https://lostlake.example") });
  const fox = await v("Fox Theatre", "theater", "Boulder", "boulder", { capacity: 625, ages: "all", contactIds: [marcus], promoterIds: [promo1] });
  const dairy = await v("Dairy Arts Center", "listening", "Boulder", "boulder", { capacity: 200, ages: "all", sound: { provider: "venueProvided" }, contactIds: [dana], promoterIds: [promo2] });
  const cervantes = await v("Cervantes' Other Side", "club", "Denver", "denver", { capacity: 400, ages: "21" });
  const washingtons = await v("Washington's", "club", "Fort Collins", "north", { capacity: 450, ages: "21" });
  await v("Swallow Hill Music", "listening", "Denver", "denver", { capacity: 250, ages: "all" });
  await db.update(ctx, "promoters", promo1, { venueIds: [fox] });
  await db.update(ctx, "promoters", promo2, { venueIds: [dairy] });

  const ums = await create("festivals", { name: "Underground Music Showcase", type: "festival", region: "denver", genres: "Indie, rock, folk", contactIds: [priya], typicalMonth: 7, website: "https://umsfest.example", sources: src("https://umsfest.example") });
  const levitt = await create("festivals", { name: "Levitt Pavilion Summer Series", type: "series", region: "denver", contactIds: [], typicalMonth: 6 });
  const folks = await create("festivals", { name: "Rocky Mountain Folks Festival", type: "festival", region: "boulder", genres: "Folk, Americana", contactIds: [], typicalMonth: 8 });
  const umsEd = await create("editions", { festivalId: ums, festivalName: "Underground Music Showcase", year: 2027, label: "2027", startDate: "2027-07-23", endDate: "2027-07-25",
    appOpens: { date: "2026-11-01", sure: "estimated" }, appDeadline: { date: "2027-01-15", sure: "target" }, applyUrl: "https://umsfest.example/apply", venueIds: [], sources: src("https://umsfest.example/apply") });
  const levittEd = await create("editions", { festivalId: levitt, festivalName: "Levitt Pavilion Summer Series", year: 2027, label: "Summer 2027", appOpens: { date: "2027-01-10", sure: "confirmed" }, appDeadline: { date: "2027-02-28", sure: "confirmed" }, venueIds: [] });
  const folksEd = await create("editions", { festivalId: folks, festivalName: "Rocky Mountain Folks Festival", year: 2027, label: "2027", startDate: "2027-08-20", endDate: "2027-08-22", appDeadline: { date: "2026-12-01", sure: "confirmed" }, venueIds: [] });

  const pitch = (target: { kind: string; id: string; name: string }, status: string, extra: Record<string, unknown> = {}) =>
    create("pitches", { target, status, artistId: artist, pitchedAs: "trio", personnel: ["ingrid", "jeff", "david"].map((k) => mid[k]), assigneeId: uid.jeff, showIds: [], ...extra });
  await pitch({ kind: "venue", id: cervantes, name: "Cervantes' Other Side" }, "idea");
  await pitch({ kind: "venue", id: dairy, name: "Dairy Arts Center" }, "toPitch", { nextStep: { text: "Fill out the spring submission form", due: "2026-11-05" } });
  const pLost = await pitch({ kind: "venue", id: lostlake, name: "Lost Lake Lounge" }, "pitched", { nextStep: { text: "Follow up with Haylee", due: "2026-10-28" }, notes: "Support slot, winter." });
  await pitch({ kind: "edition", id: folksEd, name: "Rocky Mountain Folks Festival 2027" }, "waiting", { assigneeId: uid.ingrid, nextStep: { text: "Check for decision", due: "2026-12-15" } });
  await pitch({ kind: "venue", id: fox, name: "Fox Theatre" }, "talking", { pitchedAs: "full-band", personnel: ["ingrid", "jeff", "david", "eric", "emma"].map((k) => mid[k]) });
  const pHidive = await pitch({ kind: "venue", id: hidive, name: "Hi-Dive" }, "booked");
  await pitch({ kind: "venue", id: washingtons, name: "Washington's" }, "declined", { notes: "Booked through spring." });
  await pitch({ kind: "edition", id: umsEd, name: "Underground Music Showcase 2027" }, "dropped", { notes: "Too much travel for the fee." });
  await pitch({ kind: "edition", id: levittEd, name: "Levitt Pavilion Summer Series Summer 2027" }, "idea");
  await create(`pitches/${pLost}/comments`, { authorId: uid.ingrid, body: "Mention the Roots show that drew 95." });
  await create(`pitches/${pLost}/activity`, { type: "status", fromStatus: "toPitch", toStatus: "pitched", text: "Sent first pitch" });
  await create(`pitches/${pLost}/activity`, { type: "note", text: "Haylee said to check back mid-November." });
  await seedTemplates(create);

  // --- music ---
  const songSpecs: [string, string, number, number][] = [
    ["Glass Coast", "F#m", 232, 96], ["Weathervane", "D", 250, 84], ["Low Light", "A", 211, 120], ["Ruby Hill", "E", 285, 72], ["Sundial", "Bb", 198, 108],
    ["Paper Boats", "G", 224, 90], ["North Fork", "Am", 243, 100], ["Slow Burn", "C", 266, 66], ["Kerosene", "Em", 205, 132], ["Gold Hour", "D", 238, 88],
    ["Cottonwood", "A", 219, 104], ["Last Train to Lyons", "E", 257, 112],
  ];
  const songIds: string[] = [];
  for (const [title, key, lengthSec, bpm] of songSpecs) songIds.push(await create("songs", { title, key, lengthSec, bpm, status: "active", writers: "Ingrid Avison" }));
  await create("songs", { title: "Untitled (bridge idea)", status: "idea" });
  const fileId = await create("files", { kind: "demo", title: "Glass Coast demo v3.m4a", songId: songIds[0], driveFileId: "fake-drive-demo-1", url: "http://localhost:3202/files/fake-drive-demo-1", mimeType: "audio/mp4", ownerEmail: "jeff@example.com", inBandFolder: true, sharing: "ok", checkedAt: new Date() });
  void fileId;
  await create("files", { kind: "chart", title: "Glass Coast chart F#m.docx", songId: songIds[0], key: "F#m", driveFileId: "fake-drive-chart-1", url: "http://localhost:3202/files/fake-drive-chart-1", ownerEmail: "ingrid@example.com", inBandFolder: false, sharing: { missing: [mid.eric, mid.emma] }, checkedAt: new Date() });
  const setlist = await create("setlists", {
    name: "Hi-Dive 45 min",
    items: songIds.slice(0, 11).map((id, i) => ({ type: "song", songId: id, title: songSpecs[i][0], lengthSec: songSpecs[i][2], key: songSpecs[i][1] })),
  });
  await create("rehearsals", { date: "2026-10-18", place: "Jeff's basement", personnel: ["ingrid", "jeff", "david", "eric"].map((k) => mid[k]), songs: [{ songId: songIds[0], title: "Glass Coast", note: "Tighten the bridge" }, { songId: songIds[3], title: "Ruby Hill" }], notes: "Good energy. Eric to bring the click." });

  // --- shows ---
  const cfg = (artistCfg: string) => ({
    full: ["ingrid", "jeff", "david", "eric", "emma"], trio: ["ingrid", "jeff", "david"],
  } as Record<string, string[]>)[artistCfg].map((k) => mid[k]);
  const showBase = {
    artistId: artist, needs: { poster: true, backline: false, merch: true }, docs: [], public: true, listings: {},
    checklist: [
      { id: "c1", label: "Confirm load-in time", done: true, due: "2026-11-07" },
      { id: "c2", label: "Post the poster", done: false, due: "2026-10-31" },
      { id: "c3", label: "Pack merch table", done: false, due: "2026-11-12" },
    ],
  };
  const hiShow = await create("shows", {
    ...showBase, date: "2026-11-14", status: "confirmed", venue: { id: hidive, name: "Hi-Dive", address: "7 S Broadway, Denver", city: "Denver" },
    times: { loadIn: "19:00", soundcheck: "19:30", doors: "20:30", set: "21:15", setLength: 45 }, billedAs: "full-band", personnel: cfg("full"),
    sound: { provider: "venueProvided", notes: "House engineer" }, setlistId: setlist, bandNotes: "Street parking on Broadway; dinner provided.",
    gear: [{ id: "g1", label: "Keys rig", musicianId: mid.jeff, packed: true }, { id: "g2", label: "Bass rig", musicianId: mid.david, packed: false }, { id: "g3", label: "Snare, cymbals, pedal", musicianId: mid.eric, packed: false }, { id: "g4", label: "In-ear rack", musicianId: mid.jeff, packed: false }],
  });
  await db.update(ctx, "setlists", setlist, { showId: hiShow });
  await create("showDeals", { pitchId: pHidive, contactIds: [], deal: "guarantee", guarantee: 30000, settled: false }, hiShow);
  await db.update(ctx, "pitches", pHidive, { showIds: [hiShow] });

  const lakeShow = await create("shows", {
    ...showBase, date: "2027-01-16", status: "hold", venue: { id: lostlake, name: "Lost Lake Lounge", address: "3602 E Colfax Ave, Denver", city: "Denver" },
    times: { set: "20:00", setLength: 40 }, billedAs: "trio", personnel: cfg("trio"), sound: { provider: "venueProvided" },
    needs: { poster: true, backline: false, merch: false }, checklist: [], public: false,
    gear: [{ id: "g1", label: "Keys rig", musicianId: mid.jeff, packed: false }, { id: "g2", label: "Bass rig", musicianId: mid.david, packed: false }],
  });
  await create("showDeals", { pitchId: pLost, contactIds: [haylee], deal: "doorSplit", doorSplitPct: 70, ticketPrice: 1500, settled: false }, lakeShow);
  await create("availability", {
    date: "2027-01-16", label: "Lost Lake · Sat Jan 16", pitchId: pLost, showId: lakeShow, askedMusicianIds: ["ingrid", "jeff", "david"].map((k) => mid[k]),
    responses: { [mid.ingrid]: { answer: "yes", by: "self", at: new Date() }, [mid.jeff]: { answer: "yes", by: "self", at: new Date() } },
    linkTokens: {}, sentAt: new Date(),
  });

  const playedShow = await create("shows", {
    ...showBase, date: "2026-10-10", status: "played", venue: { id: dairy, name: "Dairy Arts Center", address: "Boulder", city: "Boulder" },
    times: { loadIn: "17:00", set: "20:00", setLength: 50 }, billedAs: "trio", personnel: cfg("trio"), sound: { provider: "venueProvided" },
    needs: { poster: false, backline: false, merch: true }, checklist: [], gear: [], public: true,
  });
  await create("showDeals", { contactIds: [dana], deal: "guarantee", guarantee: 45000, paidAttendance: 112, settled: false }, playedShow);

  // --- money + reach (small) ---
  await create("expenses", { userId: uid.david, date: "2026-10-10", amount: 2850, category: "gear", what: "Bass strings and cables", showId: playedShow });
  await create("statSnapshots", { source: "spotifyApi", date: "2026-10-21", followers: 1840, popularity: 31 }, "spotifyApi_2026-10-21");
  await create("statSnapshots", { source: "spotifyApi", date: "2026-10-22", followers: 1852, popularity: 31 }, "spotifyApi_2026-10-22");

  console.log("Seeded: 6 musicians, 5 users, artist with 4 configurations, 6 venues, 3 festivals, 9 pitches, 3 shows, 12 songs, 1 setlist.");
}

async function seedTemplates(create: (path: string, doc: Record<string, unknown>, id?: string) => Promise<string>) {
  await create("emailTemplates", { name: "First pitch", subject: "{{venue.name}} · Ingrid Avison Band", body: "Hi {{contact.firstName}},\n\nWe're a Denver band... Live video: {{artist.video}}\n\nThanks,\n{{user.name}}", targetKinds: ["venue", "promoter"] });
  await create("emailTemplates", { name: "Follow up", subject: "Following up · {{artist.name}}", body: "Hi {{contact.firstName}},\n\nChecking back on {{target.name}}. Live video: {{artist.video}}\n\nThanks,\n{{user.firstName}}", targetKinds: [] });
  await create("emailTemplates", { name: "Follow up", subject: "Following up · Ingrid Avison Band", body: "Hi {{contact.firstName}},\n\nChecking back on {{venue.name}}.\n\nThanks,\n{{user.name}}", targetKinds: ["venue", "promoter", "edition"] });
  for (const t of DEFAULT_CHECKLIST_TEMPLATES) await create("checklistTemplates", { ...t });
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
