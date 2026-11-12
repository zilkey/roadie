import fs from "node:fs";
import sharp from "sharp";
import { defineFake, runIfMain, esc, need, required, HttpError, type Route } from "../lib";

export const MIME = {
  folder: "application/vnd.google-apps.folder",
  doc: "application/vnd.google-apps.document",
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  audio: "audio/mp4",
  wav: "audio/wav",
  video: "video/mp4",
  sheet: "application/vnd.google-apps.spreadsheet",
  jpeg: "image/jpeg",
  heic: "image/heic",
  png: "image/png",
} as const;

export interface DrivePermission { email: string; role: "owner" | "writer" | "reader" }
export interface DriveFile {
  id: string; name: string; mimeType: string; ownerEmail: string; parents: string[]; permissions: DrivePermission[]; createdAt: string; webViewLink: string;
  /** What was last written to a text file or a sheet (as CSV), or a Google Doc's text (its text/plain export): the fake keeps no other bytes. */
  text?: string;
  modifiedTime?: string;
  /** The band account can't read it: get answers 404 and export 403, like Drive for a doc nobody shared with the band. */
  noAccess?: boolean;
  /** A Google Doc's tabs as the Docs API's documents.get has them (tabs, tables, bold and italic). Without it, the doc is its text as one tab. */
  gdoc?: GDoc;
  /** Drive's imageMediaMetadata (the client's DriveFile.image): size as stored, before rotation; time is camera-local "YYYY:MM:DD HH:MM:SS". */
  image?: { width: number; height: number; time?: string; rotation?: number };
  size?: number;
  trashed?: boolean;
  thumbnailLink?: string;
  /** A file in tests/fixtures whose bytes GET /files/:id/content serves (the seeded photos). */
  fixture?: string;
}
/**
 * POST /__scenario: what goes wrong next. failMove: the nth move from now (a PATCH with addParents/removeParents) fails with a 500.
 * failRename: every rename fails. noMove: capabilities.canMoveChildrenWithinDrive is false. noThumbnail: these files have no preview.
 */
export interface DriveScenario { failMove?: number; failRename?: boolean; noMove?: boolean; noThumbnail?: string[] }
export interface DriveState { seq: number; files: DriveFile[]; scenario?: DriveScenario; moves?: number }

export const BAND_FOLDER_ID = "fake-band-folder";
/** The seeded Socials folder for Posts (not chosen in the seed): photos to pick, in folders and loose. */
export const SOCIALS_FOLDER_ID = "fake-folder-socials";
const MEMBERS = ["rudy", "nora", "hugo", "felix", "iris"].map((n) => `${n}@example.com`);
const link = (id: string) => `http://localhost:3202/files/${id}`;

function initial(): DriveState {
  const files: DriveFile[] = [];
  const at = "2026-09-01T12:00:00.000Z";
  const add = (id: string, name: string, mimeType: string, owner: string, parents: string[], sharedWith: string[]) =>
    files.push({ id, name, mimeType, ownerEmail: owner, parents, createdAt: at, modifiedTime: at, webViewLink: link(id),
      permissions: [{ email: owner, role: "owner" }, ...sharedWith.filter((e) => e !== owner).map((email) => ({ email, role: "reader" as const }))] });
  const all = MEMBERS;
  add(BAND_FOLDER_ID, "Nora Quill Band", MIME.folder, "nora@example.com", ["root-nora"], all);
  add("fake-folder-charts", "Charts", MIME.folder, "nora@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-demos", "Demos", MIME.folder, "rudy@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-songwriting", "Songwriting", MIME.folder, "nora@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-rehearsals", "Rehearsal recordings", MIME.folder, "rudy@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-shows", "Shows", MIME.folder, "rudy@example.com", [BAND_FOLDER_ID], all);
  // The two ids the seed script already references.
  add("fake-drive-demo-1", "Glass Coast demo v3.m4a", MIME.audio, "rudy@example.com", [BAND_FOLDER_ID], all);
  add("fake-drive-chart-1", "Glass Coast chart F#m.docx", MIME.word, "nora@example.com", ["root-nora"], all.filter((e) => !/felix|iris/.test(e)));
  const songs: [string, string, string][] = [
    ["Glass Coast", "F#m", "Am"], ["Weathervane", "D", "F"], ["Low Light", "A", "C"], ["Ruby Hill", "E", "G"], ["Sundial", "Bb", "D"], ["Paper Boats", "G", "Bb"],
    ["North Fork", "Am", "Cm"], ["Slow Burn", "C", "Eb"], ["Kerosene", "Em", "Gm"], ["Gold Hour", "D", "F"], ["Cottonwood", "A", "C"], ["Last Train to Lyons", "E", "G"],
  ];
  songs.forEach(([t, k1, k2], i) => {
    const n = i + 1;
    if (i > 0) add(`fake-demo-${n}`, `${t} demo.m4a`, MIME.audio, i % 3 === 0 ? "nora@example.com" : "rudy@example.com", [BAND_FOLDER_ID], i % 4 === 1 ? all.filter((e) => !e.startsWith("iris")) : all);
    if (i > 0) add(`fake-chart-${n}-a`, `${t} chart ${k1}.docx`, MIME.word, "nora@example.com", ["fake-folder-charts"], all);
    add(`fake-chart-${n}-b`, `${t} chart ${k2}.pdf`, MIME.pdf, "nora@example.com", i % 3 === 2 ? ["root-nora"] : ["fake-folder-charts"], i % 3 === 2 ? ["rudy@example.com"] : all);
    add(`fake-lyrics-${n}`, `${t} lyrics`, MIME.doc, "nora@example.com", i % 5 === 4 ? ["root-nora"] : [BAND_FOLDER_ID], i % 5 === 4 ? ["rudy@example.com", "iris@example.com"] : all);
  });
  // Glass Coast's lyrics Doc (seeded on the song) has text, chords over the words, so the song and rehearsal pages can show it.
  files.find((f) => f.id === "fake-lyrics-1")!.text = GLASS_COAST_LYRICS;
  // Weathervane's band version (seeded on the song as a chart): two tabs, each a two-column table of bold section names and words, italic notes.
  add("fake-band-weathervane", "Weathervane - D - Band Version", MIME.doc, "nora@example.com", [BAND_FOLDER_ID], all);
  files.find((f) => f.id === "fake-band-weathervane")!.gdoc = WEATHERVANE_DOC;
  // The seeded release's folder (Band folder / Releases / Wild Hearts LP) with its mixes and cover, plus a mix not attached yet (to add from Drive).
  add("fake-folder-releases", "Releases", MIME.folder, "rudy@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-release-wild-hearts", "Wild Hearts LP", MIME.folder, "rudy@example.com", ["fake-folder-releases"], all);
  add("fake-release-mix-1", "Low Light v1 rough.wav", MIME.wav, "rudy@example.com", ["fake-folder-release-wild-hearts"], all);
  add("fake-release-mix-2", "Low Light v2.wav", MIME.wav, "rudy@example.com", ["fake-folder-release-wild-hearts"], all);
  add("fake-release-mix-3", "Low Light v3 mix.wav", MIME.wav, "rudy@example.com", ["fake-folder-release-wild-hearts"], all);
  add("fake-release-cover", "Wild Hearts cover 3000px.png", "image/png", "nora@example.com", ["fake-folder-release-wild-hearts"], all);
  // Photos for Posts: a Posts folder (not chosen in the seed) and two JPEGs in the band folder to pick from Drive.
  add("fake-folder-posts", "Posts", MIME.folder, "rudy@example.com", [BAND_FOLDER_ID], all);
  add("fake-photo-roots", "Roots Music Project stage.jpg", MIME.jpeg, "rudy@example.com", [BAND_FOLDER_ID], all);
  add("fake-photo-deepend", "Deep End load-in.jpg", MIME.jpeg, "nora@example.com", [BAND_FOLDER_ID], all);
  add("fake-reh-1", "Rehearsal 2026-10-18 full run.wav", MIME.wav, "rudy@example.com", ["fake-folder-rehearsals"], all.filter((e) => !e.startsWith("iris")));
  add("fake-reh-2", "Rehearsal 2026-10-04 Glass Coast bridge.m4a", MIME.audio, "hugo@example.com", ["root-hugo"], ["rudy@example.com"]);
  add("fake-reh-3", "Rehearsal video Ruby Hill ending.mp4", MIME.video, "felix@example.com", ["fake-folder-rehearsals"], all);
  socials(add, files);
  return { seq: 0, files, scenario: {}, moves: 0 };
}

/**
 * The Socials folder (SOCIALS_FOLDER_ID): a phone's folder of 6 photos (2 HEIC, one stored sideways with EXIF orientation 6,
 * one taken at 01:30 the night after the seeded show played on 2026-10-10), 3 loose photos, the "2026-10" month folder #49 made
 * holding one posted photo, and a PDF (a post folder holding it isn't empty). Each photo was added a minute after the one before.
 */
type Add = (id: string, name: string, mimeType: string, owner: string, parents: string[], sharedWith: string[]) => void;
function socials(add: Add, files: DriveFile[]) {
  const all = MEMBERS;
  add(SOCIALS_FOLDER_ID, "Socials", MIME.folder, "rudy@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-socials-phone", "Jeff's phone spring 26", MIME.folder, "rudy@example.com", [SOCIALS_FOLDER_ID], all);
  add("fake-folder-socials-2026-10", "2026-10", MIME.folder, "rudy@example.com", [SOCIALS_FOLDER_ID], all);
  const photos: [id: string, name: string, mimeType: string, parent: string, image: NonNullable<DriveFile["image"]>, fixture?: string][] = [
    ["fake-social-heic-1", "IMG_2201.HEIC", MIME.heic, "fake-folder-socials-phone", { width: 4032, height: 3024, rotation: 1, time: "2026:09:20 19:45:10" }],
    // Phones and Drive often call a HEIC application/octet-stream: it's a photo by its extension.
    ["fake-social-heic-2", "IMG_2202.HEIC", "application/octet-stream", "fake-folder-socials-phone", { width: 4032, height: 3024, rotation: 1, time: "2026:09:20 19:46:02" }],
    ["fake-social-rotated", "photo-rotated.jpg", MIME.jpeg, "fake-folder-socials-phone", { width: 1200, height: 900, rotation: 1, time: "2026:10:10 21:15:00" }, "photo-rotated.jpg"],
    ["fake-social-late", "IMG_2210.JPG", MIME.jpeg, "fake-folder-socials-phone", { width: 1600, height: 1000, time: "2026:10:11 01:30:00" }, "photo-landscape.jpg"],
    ["fake-social-phone-5", "IMG_2211.JPG", MIME.jpeg, "fake-folder-socials-phone", { width: 1600, height: 1000, time: "2026:10:11 01:32:40" }, "photo-landscape.jpg"],
    ["fake-social-phone-6", "IMG_2215.JPG", MIME.jpeg, "fake-folder-socials-phone", { width: 1600, height: 1000 }, "photo-landscape.jpg"],
    ["fake-social-loose-1", "IMG_4411.JPG", MIME.jpeg, SOCIALS_FOLDER_ID, { width: 1600, height: 1000, time: "2026:11:01 20:10:00" }, "photo-landscape.jpg"],
    ["fake-social-loose-2", "IMG_4412.HEIC", MIME.heic, SOCIALS_FOLDER_ID, { width: 4032, height: 3024, rotation: 1, time: "2026:11:01 20:12:30" }],
    ["fake-social-loose-3", "Poster draft.png", MIME.png, SOCIALS_FOLDER_ID, { width: 1080, height: 1350 }],
    // The photo a #49 post put in its month folder (scripts/migrate-posts-49.ts moves it).
    ["fake-social-post49", "Roots Music Project stage.jpg", MIME.jpeg, "fake-folder-socials-2026-10", { width: 1600, height: 1000, time: "2026:10:03 22:05:00" }, "photo-landscape.jpg"],
  ];
  photos.forEach(([id, name, mimeType, parent, image, fixture], i) => {
    add(id, name, mimeType, "rudy@example.com", [parent], all);
    const f = files[files.length - 1];
    f.createdAt = f.modifiedTime = new Date(Date.parse("2026-11-01T18:00:00.000Z") + i * 60_000).toISOString();
    Object.assign(f, { image, size: 2_000_000 + i, thumbnailLink: `${link(id)}/thumbnail` }, fixture ? { fixture } : {});
  });
  add("fake-social-pdf", "Set list.pdf", MIME.pdf, "rudy@example.com", [SOCIALS_FOLDER_ID], all);
}

/** The bytes of a fixture photo (tests/fixtures), read once. */
const fixtures = new Map<string, Buffer>();
const fixture = (name: string) => fixtures.get(name) ?? fixtures.set(name, fs.readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url))).get(name)!;

/** Upright size: Drive's width/height are as stored, so an odd rotation (90° or 270°) swaps them. */
const upright = (im: { width: number; height: number; rotation?: number }) => ((im.rotation ?? 0) % 2 ? { width: im.height, height: im.width } : { width: im.width, height: im.height });

/** A preview like Drive's: an upright JPEG, its long edge `s`. A plain colour with a darker band across the top, so it isn't uniform. */
async function thumbnailOf(f: DriveFile, s: number): Promise<Buffer> {
  const { width, height } = f.image ? upright(f.image) : { width: s, height: s };
  const k = s / Math.max(width, height);
  const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
  const band = await sharp({ create: { width: w, height: Math.max(1, Math.round(h / 5)), channels: 3, background: { r: 40, g: 40, b: 60 } } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 80 } } }).composite([{ input: band, top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
}

const isFolder = (f: DriveFile) => f.mimeType === MIME.folder;
/** list()'s kind "images": an image type, or a HEIC/HEIF name (Drive's own query matches the name). */
const isImage = (f: DriveFile) => f.mimeType.includes("image/") || /\.(heic|HEIC|heif)/.test(f.name);

// ---------- Docs API documents (documents.get with includeTabsContent), the parts Roadie reads ----------

type GRun = { textRun: { content: string; textStyle: { bold?: boolean; italic?: boolean } } };
type GEl = { paragraph: { elements: GRun[] } } | { table: { tableRows: { tableCells: { content: GEl[] }[] }[] } };
export interface GDoc { title: string; tabs: { tabProperties: { tabId: string; title: string; index: number }; documentTab: { body: { content: GEl[] } } }[] }
type RunSpec = string | { b?: string; i?: string; bi?: string };

/** A paragraph: plain strings, `{ b }` bold, `{ i }` italic, `{ bi }` both; Docs ends every paragraph with "\n". */
const para = (...runs: RunSpec[]): GEl => {
  const els = runs.map((r): GRun => typeof r === "string" ? { textRun: { content: r, textStyle: {} } }
    : { textRun: { content: r.b ?? r.i ?? r.bi ?? "", textStyle: { ...(r.b !== undefined || r.bi !== undefined ? { bold: true } : {}), ...(r.i !== undefined || r.bi !== undefined ? { italic: true } : {}) } } });
  if (els.length) els[els.length - 1].textRun.content += "\n"; else els.push({ textRun: { content: "\n", textStyle: {} } });
  return { paragraph: { elements: els } };
};
/** A table: each row's cells, each cell its paragraphs. */
const table = (rows: RunSpec[][][]): GEl => ({ table: { tableRows: rows.map((cells) => ({ tableCells: cells.map((ps) => ({ content: ps.map((p) => para(p)) })) })) } });
export const gdocOf = (title: string, tabs: [string, GEl[]][]): GDoc =>
  ({ title, tabs: tabs.map(([t, content], index) => ({ tabProperties: { tabId: `t.${index}`, title: t, index }, documentTab: { body: { content: [...content, para()] } } })) });
/** A doc's plain text the way the fake exports it: every paragraph on its line, a table's cells one after another. */
const gdocText = (d: GDoc) => {
  const lines = (els: GEl[]): string[] => els.flatMap((e) => "paragraph" in e ? [e.paragraph.elements.map((r) => r.textRun.content).join("").replace(/\n$/, "")]
    : e.table.tableRows.flatMap((r) => r.tableCells.flatMap((c) => lines(c.content))));
  return d.tabs.flatMap((t) => lines(t.documentTab.body.content)).join("\n");
};

export const WEATHERVANE_DOC: GDoc = gdocOf("Weathervane - D - Band Version", [
  ["Concert D", [
    para({ b: "Weathervane" }, " - By Nora Quill"),
    para(),
    table([
      [[{ b: "Intro" }], ["D    G    A"]],
      [[{ b: "Verse 1" }], ["D            G", "Wind on the barn roof", "A                D", "Turning me round"]],
      [[{ b: "Chorus" }, { i: "Big drums" }], ["G         A", "Oh the weathervane", { bi: "(2x)" }]],
    ]),
  ]],
  ["Drums", [
    para({ b: "Weathervane" }, " - Drums"),
    para(),
    table([
      [[{ b: "Intro" }], [{ i: "Closed hat" }, { i: "1 and-a 2 and-a" }]],
      [[{ b: "Verse 1" }, { i: "Add kick drum" }], ["Wind on the barn roof", "Turning me round"]],
    ]),
  ]],
]);

/** The text/plain export of fake-lyrics-1: line breaks and runs of spaces matter (the chords sit over the words). */
export const GLASS_COAST_LYRICS = [
  "Glass Coast",
  "",
  "Verse 1",
  "F#m          D            A",
  "Salt on the window, the tide coming in",
  "F#m          D        E",
  "You drew me a harbour in the dust on the tin",
  "",
  "Chorus",
  "D              A",
  "Oh the glass coast, the glass coast",
  "",
].join("\n");

/**
 * The fake keeps no bytes, so every audio file plays the same few seconds: a WAV of a tone that swells and fades, which
 * gives the player a waveform with a shape. Built once.
 */
let toneWav: Buffer | null = null;
function tone(): Buffer {
  if (toneWav) return toneWav;
  const rate = 8000, secs = 4, n = rate * secs;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate, env = Math.abs(Math.sin(t * Math.PI * 1.5)) * (0.3 + 0.7 * Math.sin((t / secs) * Math.PI));
    b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * env * 0.8 * 32767), 44 + i * 2);
  }
  return (toneWav = b);
}

/** Every JPEG is the same 1×1 pixel. */
const PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64");

/** Hide nothing: the fake has a single flat view. */
const find = (s: DriveState, id: string) => need(s.files.find((f) => f.id === id), "File");
/** A file as files.get answers: plus capabilities on a folder (can the band account move files in and out of it). */
const view = (s: DriveState, f: DriveFile) => (isFolder(f) ? { ...f, capabilities: { canMoveChildrenWithinDrive: !s.scenario?.noMove } } : f);
const emailsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

const routes: Route<DriveState>[] = [
  ["GET", "/files", ({ query }, s) => {
    const q = query.get("q")?.toLowerCase(), parent = query.get("parent"), mime = query.get("mimeType");
    return s.files.filter((f) => !f.trashed && (!q || f.name.toLowerCase().includes(q)) && (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime));
  }],
  // DriveService.list: one page of non-trashed files under any of `parents` (comma-separated), by kind, optionally newest added first.
  ["GET", "/files/list", ({ query }, s) => {
    const parents = (query.get("parents") ?? "").split(",").filter(Boolean), kind = query.get("kind") ?? "all";
    if (!parents.length) throw new HttpError(400, "Missing parents");
    let files = s.files.filter((f) => !f.trashed && f.parents.some((p) => parents.includes(p)) && (kind === "folders" ? isFolder(f) : kind === "images" ? isImage(f) : true));
    if (query.get("orderBy") === "createdTime desc") files = files.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const size = Math.min(Number(query.get("pageSize") || 1000), 1000), start = Number(query.get("pageToken") || 0);
    const page = files.slice(start, start + size);
    return { files: page.map((f) => view(s, f)), ...(start + size < files.length ? { nextPageToken: String(start + size) } : {}) };
  }],
  ["POST", "/files", ({ body }, s) => {
    required(body, "name", "ownerEmail");
    const at = new Date().toISOString();
    const f: DriveFile = { id: `fake-new-${++s.seq}`, name: body.name, mimeType: body.mimeType ?? MIME.doc, ownerEmail: body.ownerEmail, parents: emailsOf(body.parents), createdAt: at, modifiedTime: at, webViewLink: "", permissions: [{ email: body.ownerEmail, role: "owner" }], ...(typeof body.text === "string" ? { text: body.text } : {}) };
    f.webViewLink = link(f.id);
    s.files.push(f);
    return f;
  }],
  ["GET", "/files/:id", ({ params }, s) => {
    const f = find(s, params.id);
    if (f.noAccess) throw new HttpError(404, `File not found: ${f.id}.`);
    return view(s, f);
  }],
  // files.update: name, a move (addParents/removeParents) and trashed, as the scenario allows.
  ["PATCH", "/files/:id", ({ params, body }, s) => {
    const f = find(s, params.id);
    const sc = (s.scenario ??= {});
    const add = emailsOf(body.addParents), remove = emailsOf(body.removeParents);
    if (add.length || remove.length) {
      s.moves = (s.moves ?? 0) + 1;
      if (sc.failMove && s.moves === sc.failMove) throw new HttpError(500, "Internal Error (fake: failMove)");
      for (const p of add) if (!isFolder(find(s, p))) throw new HttpError(400, `Not a folder: ${p}`);
      f.parents = [...f.parents.filter((p) => !remove.includes(p)), ...add.filter((p) => !f.parents.includes(p))];
    }
    if (typeof body.name === "string" && body.name) {
      if (sc.failRename) throw new HttpError(500, "Internal Error (fake: failRename)");
      f.name = body.name;
    }
    if (typeof body.trashed === "boolean") f.trashed = body.trashed;
    f.modifiedTime = new Date().toISOString();
    return view(s, f);
  }],
  ["POST", "/__scenario", ({ body }, s) => {
    const sc = (s.scenario ??= {});
    if (body.failMove !== undefined) { sc.failMove = Number(body.failMove) || undefined; s.moves = 0; }
    if (body.failRename !== undefined) sc.failRename = !!body.failRename;
    if (body.noMove !== undefined) sc.noMove = !!body.noMove;
    if (body.noThumbnail !== undefined) sc.noThumbnail = emailsOf(body.noThumbnail);
    return { ok: true, scenario: sc };
  }],
  // A file's preview at "=s{size}", as the thumbnailLink serves it: an upright JPEG, its long edge `s`.
  ["GET", "/thumbnails/:id", async ({ params, query }, s) => {
    const f = find(s, params.id);
    if (f.trashed || !isImage(f) || s.scenario?.noThumbnail?.includes(f.id)) throw new HttpError(404, "No thumbnail");
    const size = Number(query.get("s") || 220);
    if (!Number.isInteger(size) || size < 1 || size > 4000) throw new HttpError(400, "Bad size");
    return { bytes: await thumbnailOf(f, size), type: MIME.jpeg };
  }],
  ["PUT", "/files/:id/content", ({ params, body }, s) => {
    const f = find(s, params.id);
    if (typeof body.text === "string") f.text = body.text;
    f.modifiedTime = new Date().toISOString();
    return f;
  }],
  ["GET", "/files/:id/content", ({ params }, s) => {
    const f = find(s, params.id);
    if (f.text !== undefined) return { bytes: Buffer.from(f.text), type: "text/csv" };
    if (f.fixture) return { bytes: fixture(f.fixture), type: f.mimeType };
    if (f.mimeType === MIME.jpeg) return { bytes: PIXEL_JPEG, type: MIME.jpeg };
    if (!f.mimeType.startsWith("audio/")) throw new HttpError(400, "The fake only has bytes for audio and JPEGs");
    return { bytes: tone(), type: "audio/wav" };
  }],
  // Drive's files.export, text/plain only: a Google Doc's text. Drive starts the export with a byte order mark and ends lines with CRLF; so does the fake.
  ["GET", "/files/:id/export", ({ params, query }, s) => {
    const f = find(s, params.id);
    if (f.noAccess) throw new HttpError(403, "The caller does not have permission");
    if (query.get("mimeType") !== "text/plain") throw new HttpError(400, "The fake only exports text/plain");
    if (f.mimeType !== MIME.doc) throw new HttpError(403, "Export only supports Docs Editors files.");
    return { bytes: Buffer.from("\uFEFF" + (f.gdoc ? gdocText(f.gdoc) : f.text ?? "").replace(/\n/g, "\r\n")), type: "text/plain" };
  }],
  // The Docs API's documents.get (with includeTabsContent): the doc's tabs, or its text as one tab of paragraphs.
  ["GET", "/docs/v1/documents/:id", ({ params }, s) => {
    const f = find(s, params.id);
    if (f.noAccess) throw new HttpError(403, "The caller does not have permission");
    if (f.mimeType !== MIME.doc) throw new HttpError(400, "This operation is not supported for this document");
    return f.gdoc ?? gdocOf(f.name, [["Tab 1", (f.text ?? "").split("\n").map((l) => para(l))]]);
  }],
  // Test hook: change a Doc's text (bumping modifiedTime, as an edit in Docs would) or take away the band account's access.
  ["POST", "/files/:id/__doc", ({ params, body }, s) => {
    const f = find(s, params.id);
    if (typeof body.text === "string") { f.text = body.text; f.gdoc = undefined; f.modifiedTime = new Date().toISOString(); }
    if (body.gdoc && typeof body.gdoc === "object") { f.gdoc = body.gdoc as GDoc; f.modifiedTime = new Date().toISOString(); }
    if (typeof body.noAccess === "boolean") f.noAccess = body.noAccess;
    return f;
  }],
  ["GET", "/files/:id/permissions", ({ params }, s) => find(s, params.id).permissions],
  ["POST", "/files/:id/copy", ({ params, body }, s) => {
    const src = find(s, params.id);
    const owner = body.ownerEmail ?? src.ownerEmail;
    const f: DriveFile = { ...src, id: `fake-copy-${++s.seq}`, name: body.name ?? `Copy of ${src.name}`, ownerEmail: owner, parents: body.parentId ? [body.parentId] : src.parents, noAccess: undefined,
      permissions: [{ email: owner, role: "owner" }], createdAt: new Date().toISOString(), webViewLink: "" };
    f.webViewLink = link(f.id);
    s.files.push(f);
    return f;
  }],
  ["POST", "/files/:id/share", ({ params, body }, s) => {
    const f = find(s, params.id);
    const role = body.role === "writer" ? "writer" : "reader";
    for (const email of emailsOf(body.emails)) {
      const p = f.permissions.find((x) => x.email === email);
      if (!p) f.permissions.push({ email, role });
      else if (p.role !== "owner") p.role = role;
    }
    return f;
  }],
];

export const fakeDrive = defineFake<DriveState>({
  name: "fake-drive", defaultPort: 3202, initial, routes,
  page: (s) => `<p>Band folder id: <code>${BAND_FOLDER_ID}</code>. ${s.files.length} items.</p><table><tr><th>Id</th><th>Name</th><th>Type</th><th>Owner</th><th>Parents</th><th>Shared with</th></tr>${s.files.map((f) =>
    `<tr id="${esc(f.id)}"><td>${esc(f.id)}</td><td>${esc(f.name)}</td><td>${esc(f.mimeType.replace("application/vnd.google-apps.", "gdoc:"))}</td><td>${esc(f.ownerEmail)}</td><td>${esc(f.parents.join(", "))}</td><td>${esc(f.permissions.map((p) => `${p.email} (${p.role})`).join(", "))}</td></tr>`).join("")}</table>`,
});
runIfMain(import.meta, fakeDrive);
