/**
 * Seeds the running emulators with the PLAN's people plus Front Range sample data.
 * All writes go through src/server/db.ts with via 'import'. Idempotent: skips if already seeded.
 *   npm run seed            (emulators must be running)
 *   npm run seed -- --reset (wipe emulator data first)
 *   npm run seed -- --people (only people, the artist and templates: no demo venues, shows, songs or money;
 *                             for real data restored from a backup, docs/BACKUP.md)
 */
import { adminAuth } from "../src/server/admin";
import { db, run } from "../src/server/db";
import { importCtx } from "../src/server/ctx";
import { syncClaims } from "../src/server/session";
import { slugForArtist } from "../src/schema/artists";
import { DEV_OTHER_BAND, DEV_PEOPLE } from "../src/lib/dev-people";
import { execute } from "../src/server/commands/dispatch";
import { seedDefaultTemplates } from "../src/server/checklistTemplates";
import { updateDriving } from "@/server/driving";
import { areaFor, productFor } from "@/server/gas/price";
import { firestore } from "@/server/admin";
import { fanId } from "@/server/fans";
import { Timestamp } from "firebase-admin/firestore";
import { VenueEvent } from "@/schema";
import { eventId } from "@/server/events/refresh";

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

  const artist = await create("artists", {
    name: "Nora Quill Band",
    slug: slugForArtist("Nora Quill Band"),
    configurations: [
      { id: "full-band", name: "Full band", billingName: "Nora Quill Band", musicianIds: ["nora", "rudy", "hugo", "felix", "iris"].map((k) => mid[k]) },
      { id: "trio", name: "Trio", billingName: "Nora Quill Trio", musicianIds: ["nora", "rudy", "hugo"].map((k) => mid[k]) },
      { id: "duo", name: "Duo", billingName: "Nora Quill Duo", musicianIds: ["nora", "rudy"].map((k) => mid[k]) },
      { id: "nora-solo", name: "Nora solo", billingName: "Nora Quill", musicianIds: [mid.nora] },
    ],
    links: { spotify: "https://open.spotify.com/artist/example", instagram: "https://instagram.com/noraquill", website: "https://noraquill.example" },
    driveFolderId: "fake-band-folder",
    rehearsalFolderId: "fake-folder-rehearsals",
    showsFolderId: "fake-folder-shows",
    chartsFolderId: "fake-folder-charts",
    demosFolderId: "fake-folder-demos",
    songwritingFolderId: "fake-folder-songwriting",
    calendar: { id: "fake-band-calendar", name: "Nora Quill Band" },
    features: { fans: true },
  });

  // Every seeded person belongs to the artist, with their role there.
  const uid: Record<string, string> = {};
  for (const p of DEV_PEOPLE) {
    const u = await adminAuth().createUser({ email: p.email, displayName: p.name, emailVerified: true });
    uid[p.key] = u.uid;
    await create("users", { email: p.email, name: p.name, artists: [{ artistId: artist, role: p.role, mcpAccess: p.role === "admin" && p.key === "rudy" }], musicianId: mid[p.key] }, u.uid);
    await db.update(ctx, "musicians", mid[p.key], { userId: u.uid });
    await syncClaims(u.uid);
  }

  // Driving settings for the admin (Rudy), so gas estimates work out of the box. The member gets none (no home, no car).
  await updateDriving(uid.rudy, {
    home: { address: "742 Evergreen Terrace, Denver, CO, USA", lat: 39.7005, lng: -104.9503 },
    carName: "Subaru Outback", mpg: 28, fuelGrade: "regular",
  });
  // The stored EIA price for Denver metro, regular: fresh enough that the gas estimate never calls EIA.
  const denver = areaFor("Denver County", "CO");
  await firestore().doc(`fuelPrices/${denver.duoarea}_${productFor("regular")}`).set({
    area: "Denver", areaKind: "metro", grade: "regular", priceMilli: 3790, week: "2026-10-19", fetchedAt: Timestamp.now(),
  });

  if (process.argv.includes("--people")) {
    await seedTemplates(create, ctx, artist);
    console.log("Seeded: 6 musicians, 5 users, artist with 4 configurations, email and checklist templates (no demo data).");
    return;
  }

  // --- projects (#39): the buckets every income, expense and payout belongs to ---
  const addProject = (input: Record<string, unknown>) => create("projects", { artistId: artist, status: "open", ...input });
  const bandProject = await addProject({ kind: "band", name: "General", isDefault: true }); // what artists.create makes for a real band
  const duoProject = await addProject({ kind: "duo", name: "Duo" });
  const releaseProject = await addProject({ kind: "release", name: "Wild Hearts LP" });
  const tourProject = await addProject({ kind: "tour", name: "Spring West Tour" });
  await addProject({ kind: "video", name: "Lighthouse video" });
  const defaults: Record<string, string> = { "full-band": bandProject, trio: bandProject, duo: duoProject, "nora-solo": bandProject };
  const stored = (await db.get("artists", artist))!.configurations as { id: string }[];
  await db.update(ctx, "artists", artist, { configurations: stored.map((c) => ({ ...c, defaultProjectId: defaults[c.id] })) });

  // --- booking data ---
  const rosa = await create("contacts", { artistId: artist, name: "Rosa Jackson", title: "Talent buyer", emails: ["rosa@pinehollow.example"], phones: ["+13035550101"], instagram: "rosabooks", sources: src("https://pinehollow.example/contact") });
  const desmond = await create("contacts", { artistId: artist, name: "Desmond Webb", title: "Booking manager", emails: ["desmond@herontheatre.example"], phones: [], sources: src("https://herontheatre.example/booking") });
  const wren = await create("contacts", { artistId: artist, name: "Wren Ortiz", title: "Programming director", emails: ["wren@creameryarts.example"], phones: ["+13035550177"] });
  const anika = await create("contacts", { artistId: artist, name: "Anika Shah", title: "Festival producer", emails: ["anika@rmffest.example"], phones: [] });
  // howToPitch is the band's private note (promoterNotes); the venues they book are linked from the venues below.
  const bandCtx = importCtx("seed", undefined, artist);
  const promoter = async (input: Record<string, unknown>) => ((await execute(bandCtx, "promoters.create", input)).result as { id: string }).id;
  const promo1 = await promoter({ name: "Front Range Presents", kind: "promoter", website: "https://frontrangepresents.example", contactIds: [desmond], howToPitch: "Email Desmond with live video and two dates.", sources: src("https://frontrangepresents.example") });
  const promo2 = await promoter({ name: "Creamery Arts Center", kind: "nonprofit", contactIds: [wren], howToPitch: "Online submission form, twice a year." });
  // Venues go through venues.create: the room is the shared directory record, contactIds/promoterIds/notes become this band's private venueNotes.
  const v = async (name: string, type: string, city: string, region: string, extra: Record<string, unknown> = {}) =>
    ((await execute(bandCtx, "venues.create", { name, type, address: { city, state: "CO" }, region, ...extra })).result as { id: string }).id;
  const deepend = await v("Deep End", "bar", "Denver", "denver", { address: { street: "7 S Broadway", city: "Denver", state: "CO" }, capacity: 250, ages: "21", sound: { provider: "venueProvided", notes: "House engineer" } });
  const pinehollow = await v("Pine Hollow Lounge", "club", "Denver", "denver", { address: { street: "3602 E Colfax Ave", city: "Denver", state: "CO" }, capacity: 300, ages: "21", contactIds: [rosa], sources: src("https://pinehollow.example") });
  const fox = await v("Heron Theatre", "theater", "Boulder", "boulder", { capacity: 625, ages: "all", contactIds: [desmond], promoterIds: [promo1] });
  const creamery = await v("Creamery Arts Center", "listening", "Boulder", "boulder", { capacity: 200, ages: "all", sound: { provider: "venueProvided" }, contactIds: [wren], promoterIds: [promo2] });
  await db.update(ctx, "venues", deepend, { instagram: "deependdenver" });
  const marisol = await v("Marisol' Other Side", "club", "Denver", "denver", { capacity: 400, ages: "21" });
  const washingtons = await v("Washington's", "club", "Fort Collins", "north", { capacity: 450, ages: "21" });
  const swallow = await v("Swallow Hill Music", "listening", "Denver", "denver", { capacity: 250, ages: "all" });
  // Calendar e2e: the room for the 2026-12-12 pitch date. No other seeded pitch targets it, and no e2e spec names it.
  const bluebird = await v("Bluebird Room", "club", "Denver", "denver", { capacity: 180, ages: "21" });
  // Venue Events tab e2e (#60): Bluebird Room's calendar is an iCal feed answered by fixtures/calendars (VENUE_EVENTS_FIXTURES, set by
  // playwright.config.ts; outside e2e a refresh of this made-up address just fails); Swallow Hill has no calendar Roadie can read.
  // Two past shows are written directly: no reader keeps past shows, so only a seed can show the collapsed "Past shows" card.
  await execute(bandCtx, "venues.setCalendar", { id: bluebird, calendar: { type: "ics", url: "https://calendar.example.com/shows.ics" } });
  await execute(bandCtx, "venues.setCalendar", { id: swallow, calendar: { type: "manual", note: "Posts shows on Instagram only" } });
  for (const [n, date, title, acts] of [
    ["past-1", "2020-02-08", "The Old Example Band with Former Support", [["The Old Example Band", "headliner"], ["Former Support", "support"]]],
    ["past-2", "2020-03-06", "Retired Example Duo", [["Retired Example Duo", "headliner"]]],
  ] as const) {
    const id = eventId(bluebird, `seed-${n}`);
    await firestore().doc(`venueEvents/${id}`).set(VenueEvent.parse({
      id, venueId: bluebird, sourceId: `seed-${n}`, source: "ics", date, title, bill: "title", status: "onsale",
      acts: acts.map(([name, role]) => ({ name, role })), firstSeenAt: "2020-01-01T00:00:00.000Z", lastSeenAt: "2020-01-01T00:00:00.000Z",
    }));
  }
  // The shared venue type list: the built-in types (written on first use) plus one a band added with "Other…".
  await execute(bandCtx, "venueTypes.add", { label: "Winery" });

  // --- a second band on the same directory: its own notes on a shared room, and a duplicate room to merge ---
  const other = await seedOtherBand(create, ctx);
  await execute(bandCtx, "venues.update", { id: deepend, patch: { loadInNotes: "Alley door on Broadway; 20 minutes to load in.", notes: "Ask for Sam at the bar." } });
  await execute(other.ctx, "venues.update", { id: deepend, patch: { loadInNotes: "Fern Valley loads in the side door.", notes: "Ask for Rae. Fern Valley's own notes." } });
  // The same room entered twice ("The Deep End" does not dedupe against "Deep End"): venues.mergeInto fixes it.
  const deependDup = await v("The Deep End", "bar", "Denver", "denver", { website: "https://deep-end.example", notes: "Possible duplicate of Deep End." });
  await execute(other.ctx, "venues.update", { id: deependDup, patch: { notes: "Fern Valley saw this room as The Deep End." } });

  const ums = await create("festivals", { name: "Riverbend Music Fest", type: "festival", address: { city: "Denver", state: "CO" }, genres: "Indie, rock, folk", typicalMonth: 7, website: "https://rmffest.example", sources: src("https://rmffest.example") });
  const levitt = await create("festivals", { name: "Levitt Pavilion Summer Series", type: "series", address: { city: "Littleton", state: "CO" }, typicalMonth: 6 });
  const folks = await create("festivals", { name: "Rocky Mountain Folks Festival", type: "festival", address: { city: "Lyons", state: "CO" }, genres: "Folk, Americana", typicalMonth: 8 });
  // A festival's contacts are the band's own (festivalNotes.contactIds).
  await execute(bandCtx, "contacts.attach", { contactId: anika, kind: "festivals", id: ums });
  const umsEd = await create("editions", { festivalId: ums, festivalName: "Riverbend Music Fest", year: 2027, label: "2027", startDate: "2027-07-23", endDate: "2027-07-25",
    appOpens: { date: "2026-11-01", sure: "estimated" }, appDeadline: { date: "2027-01-15", sure: "target" }, applyUrl: "https://rmffest.example/apply", venueIds: [], sources: src("https://rmffest.example/apply") });
  const levittEd = await create("editions", { festivalId: levitt, festivalName: "Levitt Pavilion Summer Series", year: 2027, label: "Summer 2027", appOpens: { date: "2027-01-10", sure: "confirmed" }, appDeadline: { date: "2027-02-28", sure: "confirmed" }, venueIds: [] });
  const folksEd = await create("editions", { festivalId: folks, festivalName: "Rocky Mountain Folks Festival", year: 2027, label: "2027", startDate: "2027-08-20", endDate: "2027-08-22", appDeadline: { date: "2026-12-01", sure: "confirmed" }, venueIds: [] });

  const pitch = (target: { kind: string; id: string; name: string }, status: string, extra: Record<string, unknown> = {}) =>
    create("pitches", { target, status, artistId: artist, pitchedAs: "trio", personnel: ["nora", "rudy", "hugo"].map((k) => mid[k]), assigneeId: uid.rudy, showIds: [], ...extra });
  await pitch({ kind: "venue", id: marisol, name: "Marisol' Other Side" }, "idea");
  await pitch({ kind: "venue", id: creamery, name: "Creamery Arts Center" }, "toPitch", { nextStep: { text: "Fill out the spring submission form", due: "2026-11-05" }, dates: ["2027-03-12", "2027-03-19"] });
  const pLost = await pitch({ kind: "venue", id: pinehollow, name: "Pine Hollow Lounge" }, "pitched", { nextStep: { text: "Follow up with Rosa", due: "2026-10-28" }, notes: "Support slot, winter.", dates: ["2026-09-12", "2027-01-16", "2027-01-23"] });
  await pitch({ kind: "edition", id: folksEd, name: "Rocky Mountain Folks Festival 2027" }, "pitched", { assigneeId: uid.nora, nextStep: { text: "Check for decision", due: "2026-12-15" }, dates: ["2027-07-23"] });
  await pitch({ kind: "venue", id: fox, name: "Heron Theatre" }, "talking", { pitchedAs: "full-band", personnel: ["nora", "rudy", "hugo", "felix", "iris"].map((k) => mid[k]), lastContactAt: new Date(Date.now() - 3 * 86_400_000) });
  const pDeepend = await pitch({ kind: "venue", id: deepend, name: "Deep End" }, "booked");
  await pitch({ kind: "venue", id: washingtons, name: "Washington's" }, "declined", { notes: "Booked through spring." });
  await pitch({ kind: "edition", id: umsEd, name: "Riverbend Music Fest 2027" }, "dropped", { notes: "Too much travel for the fee." });
  await pitch({ kind: "edition", id: levittEd, name: "Levitt Pavilion Summer Series Summer 2027" }, "idea");
  // Calendar e2e: a live pitch date on 2026-12-12, the same day as the confirmed show below (a show + pitch date conflict).
  await pitch({ kind: "venue", id: bluebird, name: "Bluebird Room" }, "pitched", { dates: ["2026-12-12"], lastContactAt: new Date(Date.now() - 20 * 86_400_000) }); // quiet: a yellow row on the Pitch List
  await create(`pitches/${pLost}/comments`, { authorId: uid.nora, body: "Mention the Roots show that drew 95." });
  await create(`pitches/${pLost}/activity`, { type: "status", fromStatus: "toPitch", toStatus: "pitched", text: "Sent first pitch" });
  await create(`pitches/${pLost}/activity`, { type: "note", text: "Rosa said to check back mid-November." });
  const [promoTemplate] = await seedTemplates(create, ctx, artist);
  await run(ctx, (w) => seedDefaultTemplates(w, other.artist));

  // --- music ---
  const songSpecs: [string, string, number, number][] = [
    ["Glass Coast", "F#m", 232, 96], ["Weathervane", "D", 250, 84], ["Low Light", "A", 211, 120], ["Ruby Hill", "E", 285, 72], ["Sundial", "Bb", 198, 108],
    ["Paper Boats", "G", 224, 90], ["North Fork", "Am", 243, 100], ["Slow Burn", "C", 266, 66], ["Kerosene", "Em", 205, 132], ["Gold Hour", "D", 238, 88],
    ["Cottonwood", "A", 219, 104], ["Last Train to Lyons", "E", 257, 112],
  ];
  const songIds: string[] = [];
  for (const [title, key, lengthSec, bpm] of songSpecs) songIds.push(await create("songs", { title, key, lengthSec, bpm, status: "active", writers: "Nora Quill" }));
  await create("songs", { title: "Untitled (bridge idea)", status: "writing" });
  await create("songs", { title: "Halfway Home", status: "writing", writers: "Nora Quill" });
  const fileId = await create("files", { kind: "demo", title: "Glass Coast demo v3.m4a", songId: songIds[0], driveFileId: "fake-drive-demo-1", url: "http://localhost:3202/files/fake-drive-demo-1", mimeType: "audio/mp4", ownerEmail: "rudy@example.com", inBandFolder: true, sharing: "ok", checkedAt: new Date() });
  void fileId;
  await create("files", { kind: "chart", title: "Glass Coast chart F#m.docx", songId: songIds[0], key: "F#m", driveFileId: "fake-drive-chart-1", url: "http://localhost:3202/files/fake-drive-chart-1", ownerEmail: "nora@example.com", inBandFolder: false, sharing: { missing: [mid.felix, mid.iris] }, checkedAt: new Date() });
  // A Google Doc of lyrics (#18): the song and rehearsal pages read its text from the fake Drive and show it inline. No text cached yet.
  await create("files", { kind: "lyrics", title: "Glass Coast lyrics", songId: songIds[0], driveFileId: "fake-lyrics-1", url: "http://localhost:3202/files/fake-lyrics-1", mimeType: "application/vnd.google-apps.document", ownerEmail: "nora@example.com", inBandFolder: true, sharing: "ok", checkedAt: new Date() });
  // Non-Drive links (no driveFileId/owner/sharing): one Spotify link, and a two-link "Demo" cell (two file docs on one song).
  // A Google Doc with two tabs (Concert D, Drums), each a two-column table with bold and italic: the song page shows the tab bar and the table.
  await create("files", { kind: "chart", title: "Weathervane - D - Band Version", songId: songIds[1], driveFileId: "fake-band-weathervane", url: "http://localhost:3202/files/fake-band-weathervane", mimeType: "application/vnd.google-apps.document", ownerEmail: "nora@example.com", inBandFolder: true, sharing: "ok", checkedAt: new Date() });
  await create("files", { kind: "recording", title: "Weathervane on Spotify", songId: songIds[1], provider: "spotify", url: "https://open.spotify.com/track/0000000000000000000000", checkedAt: new Date() });
  await create("files", { kind: "demo", title: "Low Light demo (voice memo)", songId: songIds[2], provider: "web", url: "https://example.com/demos/low-light-memo", checkedAt: new Date() });
  await create("files", { kind: "demo", title: "Low Light demo (YouTube)", songId: songIds[2], provider: "youtube", url: "https://www.youtube.com/watch?v=00000000000", checkedAt: new Date() });
  await create("rehearsals", { date: "2026-10-18", projectId: bandProject, location: { name: "Rudy's basement" }, personnel: ["nora", "rudy", "hugo", "felix"].map((k) => mid[k]), songs: [{ songId: songIds[0], title: "Glass Coast", note: "Tighten the bridge" }, { songId: songIds[3], title: "Ruby Hill" }], notes: "Good energy. Felix to bring the click." });
  // A rehearsal with a full location (the autocomplete's shape) and times: the gas estimate's "To" and the drive both come from it.
  await create("rehearsals", { date: "2026-10-29", projectId: bandProject, startTime: "19:00", endTime: "22:00", location: { name: "The Attic", address: "2363 Alder St, Denver, CO, USA", lat: 39.7526, lng: -104.9868 },
    personnel: ["nora", "rudy", "hugo", "felix"].map((k) => mid[k]), songs: [{ songId: songIds[8], title: "Kerosene" }, { songId: songIds[9], title: "Gold Hour", note: "Check the key change" }] });

  const person = (key: string) => DEV_PEOPLE.find((p) => p.key === key)!.name;
  // --- the release (#12): Wild Hearts LP, on the release project above; ten tracks from the songs, a couple of mixes and the cover ---
  const releaseId = await create("releases", {
    artistId: artist, title: "Wild Hearts LP", kind: "album", projectId: releaseProject, releaseDate: "2027-03-06",
    formats: "Digital, CD, Vinyl", driveFolderId: "fake-folder-release-wild-hearts",
  });
  const trackStatus = ["mixed", "mixed", "mixed", "mixing", "mixed", "mixed", "mixed", "mixing", "overdubs", "overdubs"];
  const trackIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    trackIds.push(await create(`releases/${releaseId}/tracks`, {
      releaseId, position: i + 1, side: i < 5 ? "A" : "B", songId: songIds[i], title: songSpecs[i][0], status: trackStatus[i], lengthSec: songSpecs[i][2],
      credits: i === 2 ? [{ who: "Nora Quill", role: "Lead vocals, acoustic guitar" }, { who: "Rudy Pike", role: "Electric guitar" }] : [],
    }));
  }
  const releaseFile = (input: Record<string, unknown>) => create("files", { releaseId, ownerEmail: "rudy@example.com", inBandFolder: true, sharing: "ok", checkedAt: new Date(), ...input });
  await releaseFile({ kind: "mix", title: "Low Light v1 rough.wav", releaseTrackId: trackIds[2], version: 1, driveFileId: "fake-release-mix-1", url: "http://localhost:3202/files/fake-release-mix-1", mimeType: "audio/wav",
    notes: [{ id: "n1", authorId: uid.rudy, name: person("rudy"), body: "Guitar solo a touch quieter.", at: "2026-10-14T18:00:00.000Z" }] });
  await releaseFile({ kind: "mix", title: "Low Light v2.wav", releaseTrackId: trackIds[2], version: 2, approved: true, driveFileId: "fake-release-mix-2", url: "http://localhost:3202/files/fake-release-mix-2", mimeType: "audio/wav" });
  await releaseFile({ kind: "artwork", title: "Wild Hearts cover 3000px.png", driveFileId: "fake-release-cover", url: "http://localhost:3202/files/fake-release-cover", mimeType: "image/png", ownerEmail: "nora@example.com" });

  // --- shows ---
  const cfg = (artistCfg: string) => ({
    full: ["nora", "rudy", "hugo", "felix", "iris"], trio: ["nora", "rudy", "hugo"],
  } as Record<string, string[]>)[artistCfg].map((k) => mid[k]);
  const showBase = {
    artistId: artist, projectId: bandProject, needs: { poster: true, backline: false, merch: true }, docs: [], publishToBandsintown: true, listings: {},
    checklists: [{ id: "promo", name: "Promo", templateId: promoTemplate, items: [
      { id: "c1", label: "Make show poster", done: true, ownerId: mid.nora, doneAt: "2026-10-20T18:00:00.000Z", doneBy: uid.nora },
      { id: "c2", label: "Post on social media", done: false, ownerId: mid.rudy },
      { id: "c3", label: "Send email to email list", done: false },
    ] }],
  };
  /** An ordinary list made on the show (no template): [id, label, who or "", done]. */
  const list = (id: string, name: string, items: [string, string, string, boolean][]) => ({
    id, name, templateId: null, items: items.map(([iid, label, who, done]) => ({ id: iid, label, done, ...(who ? { ownerId: mid[who] } : {}) })),
  });
  const hiShow = await create("shows", {
    ...showBase, date: "2026-11-14", status: "confirmed", venue: { id: deepend, name: "Deep End", address: "7 S Broadway, Denver", city: "Denver" },
    times: { loadIn: "19:00", soundcheck: "19:30", doors: "20:30", set: "21:15", setLengthSec: 2700 }, billedAs: "full-band", personnel: cfg("full"),
    sound: { provider: "venueProvided", notes: "House engineer" }, dayOfContact: { name: "Deep End door manager", phone: "(303) 555-0142" },
    checklists: [...showBase.checklists, list("loadout", "Load-out", [["g1", "Get paid before leaving", "rudy", false], ["g2", "Sweep stage for cables", "felix", false], ["g3", "Bass rig", "hugo", false]])],
  });
  await create(`shows/${hiShow}/comments`, { authorId: uid.nora, body: "Street parking on Broadway; dinner provided.", audience: "band" });
  // The show's setlist lives at setlists/{showId}: the document id is the show id, so it is written after the show.
  await create("setlists", {
    items: songIds.slice(0, 11).map((id, i) => ({ type: "song", songId: id, title: songSpecs[i][0], lengthSec: songSpecs[i][2], key: songSpecs[i][1] })),
  }, hiShow);
  await create("showDeals", { pitchId: pDeepend, contactIds: [], deal: "guarantee" }, hiShow);
  await db.update(ctx, "pitches", pDeepend, { showIds: [hiShow] });

  const lakeShow = await create("shows", {
    ...showBase, date: "2027-01-16", status: "hold", venue: { id: pinehollow, name: "Pine Hollow Lounge", address: "3602 E Colfax Ave, Denver", city: "Denver" },
    times: { set: "20:00", setLengthSec: 2400 }, billedAs: "trio", personnel: cfg("trio"), sound: { provider: "venueProvided" },
    needs: { poster: true, backline: false, merch: false }, publishToBandsintown: false,
    checklists: [list("gear", "Gear", [["g1", "Keys rig", "rudy", false], ["g2", "Bass rig", "hugo", false], ["g3", "Merch table", "", false]])],
  });
  await create("showDeals", { pitchId: pLost, contactIds: [rosa], deal: "doorSplit", doorSplitPct: 70, ticketPrice: 1500 }, lakeShow);
  await create("availability", {
    date: "2027-01-16", label: "Pine Hollow · Sat Jan 16", pitchId: pLost, showId: lakeShow, askedMusicianIds: ["nora", "rudy", "hugo"].map((k) => mid[k]),
    responses: { [mid.nora]: { answer: "yes", by: "self", at: new Date() }, [mid.rudy]: { answer: "yes", by: "self", at: new Date() } },
    linkTokens: {}, sentAt: new Date(),
  });

  // Calendar e2e: a confirmed show on 2026-12-12 at Marisol' Other Side (the same day as the Bluebird Room pitch date above).
  await create("shows", {
    ...showBase, date: "2026-12-12", status: "confirmed", venue: { id: marisol, name: "Marisol' Other Side", address: "Denver", city: "Denver" },
    times: { loadIn: "19:00", soundcheck: "19:30", doors: "20:30", set: "21:15", setLengthSec: 2700 }, billedAs: "trio", personnel: cfg("trio"),
    sound: { provider: "venueProvided", notes: "House engineer" }, dayOfContact: { name: "Marisol' door manager", phone: "(303) 555-0188" },
  });

  const playedShow = await create("shows", {
    ...showBase, date: "2026-10-10", status: "played", venue: { id: creamery, name: "Creamery Arts Center", address: "Boulder", city: "Boulder" },
    times: { loadIn: "17:00", set: "20:00", setLengthSec: 3000 }, billedAs: "trio", personnel: cfg("trio"), sound: { provider: "venueProvided" },
    needs: { poster: false, backline: false, merch: true }, checklists: [], publishToBandsintown: true,
  });
  await create("showDeals", { contactIds: [wren], deal: "guarantee", paidAttendance: 112 }, playedShow);

  // --- fans (the email list): one already in Bandzoogle, two not, one with no city ---
  const fan = (email: string, extra: Record<string, unknown>) =>
    create("fans", { artistId: artist, email, cities: [], showIds: [], source: "list", lastSeenAt: new Date(), ...extra }, fanId(artist, email));
  await fan("ann@example.com", { firstName: "Ann", cities: [{ city: "Boulder", state: "CO" }], showIds: [playedShow], bandzoogle: { addedAt: new Date(), group: "Boulder, CO" } });
  await fan("bo@example.com", { firstName: "Bo", cities: [{ city: "Boulder", state: "CO" }], showIds: [playedShow] });
  await fan("cy@example.com", { firstName: "Cy", cities: [{ city: "Denver", state: "CO" }], showIds: [hiShow], source: "paper" });
  await fan("dee@example.com", {});

  // --- money + reach (small) ---
  await create("expenses", { userId: uid.hugo, date: "2026-10-10", amount: 2850, category: "gear", what: "Bass strings and cables", showId: playedShow, projectId: bandProject });
  // A pay-back expense in a member's name, on the tour: the band owes Hugo until an admin pays it back.
  await create("expenses", { userId: uid.hugo, date: "2026-10-24", amount: 14000, category: "lodging", what: "Motel deposit for the tour", projectId: tourProject });
  // The release's spend: studio time on the project, and one mix's revisions pinned to its track.
  await create("expenses", { userId: uid.rudy, date: "2026-09-14", amount: 180000, category: "recording", what: "3 days tracking", projectId: releaseProject, payBack: false });
  await create("expenses", { userId: uid.rudy, date: "2026-10-20", amount: 30000, category: "mixing", what: "Mix v2 revisions", notes: "Vocal up a hair in the last chorus", projectId: releaseProject, releaseTrackId: trackIds[2], payBack: false });
  // A vendor paid by an admin from her own account (nothing to pay back), and a bill nobody has paid yet.
  await create("expenses", { userId: uid.nora, date: "2026-10-03", amount: 6000, category: "space", what: "Room rental", to: { name: "Woodshed Studio" }, payBack: false, projectId: bandProject });
  await create("expenses", { userId: uid.rudy, date: "2026-10-20", amount: 23000, category: "space", what: "Video studio day", to: { name: "Video Studio Space" }, owed: true, payBack: false, projectId: bandProject });

  // --- income (#39): what came in and what is still owed to the band (no receivedAt) ---
  const income = (input: Record<string, unknown>) => create("income", { artistId: artist, projectId: bandProject, ...input });
  // The played show's guarantee, received.
  await income({ date: "2026-10-10", amount: 45000, category: "guarantee", method: "check", from: "Creamery Arts Center", showId: playedShow, receivedAt: "2026-10-10" });
  await income({ date: "2027-01-16", amount: 30000, category: "guarantee", from: "Pine Hollow Lounge", showId: lakeShow });
  await income({ date: "2026-10-15", amount: 18400, category: "streaming", from: "Bandcamp", projectId: releaseProject, notes: "October sales, not yet transferred" });
  await income({ date: "2026-10-05", amount: 40000, category: "crowdfunding", from: "Backer pledges", projectId: releaseProject, receivedAt: "2026-10-05", method: "bank" });

  // --- payouts (#39): what the band paid or still owes people ---
  await create("payouts", { artistId: artist, projectId: bandProject, to: { userId: uid.hugo, name: person("hugo") }, kind: "pay", amount: 7500, what: "Creamery Arts Center show",
    showId: playedShow, paidAt: "2026-10-12", method: "venmo", paidBy: uid.rudy });
  await create("payouts", { artistId: artist, projectId: bandProject, to: { name: "The Moonlighters" }, kind: "split", amount: 15000, what: "Their cut of the Deep End bill",
    showId: hiShow, dueDate: "2026-11-15" });
  await create("payouts", { artistId: artist, projectId: bandProject, to: { musicianId: mid.felix, name: person("felix") }, kind: "pay", amount: 6000, what: "Deep End show",
    showId: hiShow, dueDate: "2026-11-15" });
  await create("statSnapshots", { source: "spotifyApi", date: "2026-10-21", followers: 1840, popularity: 31 }, "spotifyApi_2026-10-21");
  await create("statSnapshots", { source: "spotifyApi", date: "2026-10-22", followers: 1852, popularity: 31 }, "spotifyApi_2026-10-22");

  console.log("Seeded: 7 musicians, 6 users in 2 artists (Fern Valley Trio shares the venue directory), artist with 4 configurations, 9 venues, 3 festivals, 10 pitches, 4 shows, 12 songs, 1 show setlist, 5 projects, 1 release with 10 tracks, 6 expenses, 4 income, 3 payouts.");
}

/** The second artist: Fern Valley Trio, with one admin (Olga) and nothing else. Returns a context for her band. */
async function seedOtherBand(create: (path: string, doc: Record<string, unknown>, id?: string) => Promise<string>, ctx: ReturnType<typeof importCtx>) {
  const p = DEV_OTHER_BAND.person;
  const mid = await create("musicians", { name: p.name, instruments: p.instruments, active: true }); // no email: the first band's Drive sharing checks list musicians with an email
  const artist = await create("artists", {
    name: DEV_OTHER_BAND.artistName, slug: slugForArtist(DEV_OTHER_BAND.artistName),
    configurations: [{ id: "trio", name: "Trio", billingName: DEV_OTHER_BAND.artistName, musicianIds: [mid] }], links: {}, driveFolderId: "",
  });
  const u = await adminAuth().createUser({ email: p.email, displayName: p.name, emailVerified: true });
  await create("users", { email: p.email, name: p.name, artists: [{ artistId: artist, role: p.role, mcpAccess: false }], musicianId: mid }, u.uid);
  await db.update(ctx, "musicians", mid, { userId: u.uid });
  await syncClaims(u.uid);
  return { artist, ctx: importCtx("seed", undefined, artist) };
}

/** The starting email templates. */
async function seedEmailTemplates(create: (path: string, doc: Record<string, unknown>, id?: string) => Promise<string>) {
  await create("emailTemplates", { name: "First pitch", subject: "{{venue.name}} · Nora Quill Band", body: "Hi {{contact.firstName}},\n\nWe're a Denver band... Live video: {{artist.video}}\n\nThanks,\n{{user.name}}", targetKinds: ["venue", "promoter"] });
  await create("emailTemplates", { name: "Follow up", subject: "Following up · {{artist.name}}", body: "Hi {{contact.firstName}},\n\nChecking back on {{target.name}}. Live video: {{artist.video}}\n\nThanks,\n{{user.firstName}}", targetKinds: [] });
  await create("emailTemplates", { name: "Follow up", subject: "Following up · Nora Quill Band", body: "Hi {{contact.firstName}},\n\nChecking back on {{venue.name}}.\n\nThanks,\n{{user.name}}", targetKinds: ["venue", "promoter", "edition"] });
}

/** This seed's artist is written with db.create rather than artists.create, so it needs the checklist templates too. */
async function seedTemplates(create: (path: string, doc: Record<string, unknown>, id?: string) => Promise<string>, ctx: ReturnType<typeof importCtx>, artist: string) {
  await seedEmailTemplates(create);
  return run(ctx, (w) => seedDefaultTemplates(w, artist));
}

// Guarded like the other scripts here, so importing this file does not run the seed.
if (process.argv[1]?.endsWith("seed.ts")) main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
