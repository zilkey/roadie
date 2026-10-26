import { defineFake, runIfMain, esc, need, required, type Route } from "../lib";

export const MIME = {
  folder: "application/vnd.google-apps.folder",
  doc: "application/vnd.google-apps.document",
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  audio: "audio/mp4",
  wav: "audio/wav",
  video: "video/mp4",
} as const;

export interface DrivePermission { email: string; role: "owner" | "writer" | "reader" }
export interface DriveFile { id: string; name: string; mimeType: string; ownerEmail: string; parents: string[]; permissions: DrivePermission[]; createdAt: string; webViewLink: string }
export interface DriveState { seq: number; files: DriveFile[] }

export const BAND_FOLDER_ID = "fake-band-folder";
const MEMBERS = ["jeff", "ingrid", "david", "eric", "emma"].map((n) => `${n}@example.com`);
const link = (id: string) => `http://localhost:3202/files/${id}`;

function initial(): DriveState {
  const files: DriveFile[] = [];
  const at = "2026-09-01T12:00:00.000Z";
  const add = (id: string, name: string, mimeType: string, owner: string, parents: string[], sharedWith: string[]) =>
    files.push({ id, name, mimeType, ownerEmail: owner, parents, createdAt: at, webViewLink: link(id),
      permissions: [{ email: owner, role: "owner" }, ...sharedWith.filter((e) => e !== owner).map((email) => ({ email, role: "reader" as const }))] });
  const all = MEMBERS;
  add(BAND_FOLDER_ID, "Ingrid Avison Band", MIME.folder, "ingrid@example.com", ["root-ingrid"], all);
  add("fake-folder-charts", "Charts", MIME.folder, "ingrid@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-demos", "Demos", MIME.folder, "jeff@example.com", [BAND_FOLDER_ID], all);
  add("fake-folder-rehearsals", "Rehearsal recordings", MIME.folder, "jeff@example.com", [BAND_FOLDER_ID], all);
  // The two ids the seed script already references.
  add("fake-drive-demo-1", "Glass Coast demo v3.m4a", MIME.audio, "jeff@example.com", [BAND_FOLDER_ID], all);
  add("fake-drive-chart-1", "Glass Coast chart F#m.docx", MIME.word, "ingrid@example.com", ["root-ingrid"], all.filter((e) => !/eric|emma/.test(e)));
  const songs: [string, string, string][] = [
    ["Glass Coast", "F#m", "Am"], ["Weathervane", "D", "F"], ["Low Light", "A", "C"], ["Ruby Hill", "E", "G"], ["Sundial", "Bb", "D"], ["Paper Boats", "G", "Bb"],
    ["North Fork", "Am", "Cm"], ["Slow Burn", "C", "Eb"], ["Kerosene", "Em", "Gm"], ["Gold Hour", "D", "F"], ["Cottonwood", "A", "C"], ["Last Train to Lyons", "E", "G"],
  ];
  songs.forEach(([t, k1, k2], i) => {
    const n = i + 1;
    if (i > 0) add(`fake-demo-${n}`, `${t} demo.m4a`, MIME.audio, i % 3 === 0 ? "ingrid@example.com" : "jeff@example.com", [BAND_FOLDER_ID], i % 4 === 1 ? all.filter((e) => !e.startsWith("emma")) : all);
    if (i > 0) add(`fake-chart-${n}-a`, `${t} chart ${k1}.docx`, MIME.word, "ingrid@example.com", ["fake-folder-charts"], all);
    add(`fake-chart-${n}-b`, `${t} chart ${k2}.pdf`, MIME.pdf, "ingrid@example.com", i % 3 === 2 ? ["root-ingrid"] : ["fake-folder-charts"], i % 3 === 2 ? ["jeff@example.com"] : all);
    add(`fake-lyrics-${n}`, `${t} lyrics`, MIME.doc, "ingrid@example.com", i % 5 === 4 ? ["root-ingrid"] : [BAND_FOLDER_ID], i % 5 === 4 ? ["jeff@example.com", "emma@example.com"] : all);
  });
  add("fake-reh-1", "Rehearsal 2026-10-18 full run.wav", MIME.wav, "jeff@example.com", ["fake-folder-rehearsals"], all.filter((e) => !e.startsWith("emma")));
  add("fake-reh-2", "Rehearsal 2026-10-04 Glass Coast bridge.m4a", MIME.audio, "david@example.com", ["root-david"], ["jeff@example.com"]);
  add("fake-reh-3", "Rehearsal video Ruby Hill ending.mp4", MIME.video, "eric@example.com", ["fake-folder-rehearsals"], all);
  return { seq: 0, files };
}

/** Hide nothing: the fake has a single flat view. */
const find = (s: DriveState, id: string) => need(s.files.find((f) => f.id === id), "File");
const emailsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

const routes: Route<DriveState>[] = [
  ["GET", "/files", ({ query }, s) => {
    const q = query.get("q")?.toLowerCase(), parent = query.get("parent"), mime = query.get("mimeType");
    return s.files.filter((f) => (!q || f.name.toLowerCase().includes(q)) && (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime));
  }],
  ["POST", "/files", ({ body }, s) => {
    required(body, "name", "ownerEmail");
    const f: DriveFile = { id: `fake-new-${++s.seq}`, name: body.name, mimeType: body.mimeType ?? MIME.doc, ownerEmail: body.ownerEmail, parents: emailsOf(body.parents), createdAt: new Date().toISOString(), webViewLink: "", permissions: [{ email: body.ownerEmail, role: "owner" }] };
    f.webViewLink = link(f.id);
    s.files.push(f);
    return f;
  }],
  ["GET", "/files/:id", ({ params }, s) => find(s, params.id)],
  ["GET", "/files/:id/permissions", ({ params }, s) => find(s, params.id).permissions],
  ["POST", "/files/:id/copy", ({ params, body }, s) => {
    const src = find(s, params.id);
    const owner = body.ownerEmail ?? src.ownerEmail;
    const f: DriveFile = { ...src, id: `fake-copy-${++s.seq}`, name: body.name ?? `Copy of ${src.name}`, ownerEmail: owner, parents: body.parentId ? [body.parentId] : src.parents,
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
