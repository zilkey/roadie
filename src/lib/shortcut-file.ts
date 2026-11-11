/**
 * The "Send to Roadie" iOS Shortcut as a file, built from the recipe instead of by hand: share a voice memo to it, it
 * asks which rehearsal (unless one is on right now) and which songs, uploads the memo and shows a notification with
 * what happened, success or failure. `buildShortcutPlist` writes the Shortcuts plist (the old, unsigned format);
 * `scripts/build-shortcut.ts` signs it on a Mac (`shortcuts sign --mode anyone`) into public/shortcuts, which Settings >
 * Google offers as Download Send to Roadie. The token is an import question, asked once when the Shortcut is installed,
 * so the file is the same for every admin. Bump SHORTCUT_VERSION whenever the recipe changes and rebuild.
 */
export const SHORTCUT_VERSION = 3;
export const SHORTCUT_NAME = "Send to Roadie";
export const SHORTCUT_PATH = "/shortcuts/send-to-roadie.shortcut";
export const SHORTCUT_PLIST_PATH = "/shortcuts/send-to-roadie.plist";
/** The import question shown when the Shortcut is installed; the answer becomes the Text action's content. */
export const TOKEN_QUESTION = "Your Roadie shortcut token (Settings > Google > Voice memo shortcut)";

type Plist = string | number | boolean | Plist[] | { [k: string]: Plist };

/* ---- Shortcuts' value encodings ---- */

/** The output of an earlier action, by UUID. */
const output = (uuid: string, name: string) => ({ Type: "ActionOutput", OutputUUID: uuid, OutputName: name });
/** A named variable (Set Variable), the Repeat Item, or the Shortcut Input. */
const variable = (name: string) => ({ Type: "Variable", VariableName: name });
const shortcutInput = { Type: "ExtensionInput" };
const attachment = (v: Plist) => ({ Value: v, WFSerializationType: "WFTextTokenAttachment" });
/** Text with attachments: each `￼` in the string is one attachment, placed by range. */
const text = (parts: (string | { [k: string]: Plist })[]) => {
  let s = "";
  const attachmentsByRange: { [k: string]: Plist } = {};
  for (const p of parts) {
    if (typeof p === "string") { s += p; continue; }
    attachmentsByRange[`{${s.length}, 1}`] = p;
    s += "￼";
  }
  return { Value: { string: s, attachmentsByRange }, WFSerializationType: "WFTextTokenString" };
};
const FIELD_TEXT = 0, FIELD_FILE = 5;
const field = (key: string, value: Plist, type = FIELD_TEXT) => ({ WFItemType: type, WFKey: text([key]), WFValue: value });
const fields = (items: Plist[]) => ({ Value: { WFDictionaryFieldValueItems: items }, WFSerializationType: "WFDictionaryFieldValue" });

/* ---- the actions ---- */

/** Deterministic UUIDs (uppercase, as Shortcuts writes them) so the built file doesn't change between runs. */
const uuid = (n: number) => `0000${SHORTCUT_VERSION.toString(16).padStart(4, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`.toUpperCase();
const CONDITION_HAS_VALUE = 100;
const START = 0, OTHERWISE = 1, END = 2;

interface Action { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: { [k: string]: Plist } }

export const buildShortcutPlist = (appUrl: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plist(buildShortcut(appUrl), 0)}</plist>\n`;

/** The Shortcut as the object the plist holds; `WFWorkflowActions` is the list of actions in order. */
export function buildShortcut(appUrl: string): { [k: string]: Plist } {
  const base = appUrl.replace(/\/$/, "");
  let n = 0;
  const actions: Action[] = [];
  const add = (id: string, params: { [k: string]: Plist }, withUuid = true) => {
    const u = uuid(++n);
    actions.push({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: withUuid ? { ...params, UUID: u } : params });
    return u;
  };
  const header = (tokenUuid: string) => fields([field("Authorization", text(["Bearer ", output(tokenUuid, "Token")]))]);
  const get = (url: Plist, token: string) => add("downloadurl", { WFURL: url, WFHTTPMethod: "GET", WFHTTPHeaders: header(token), Advanced: true, ShowHeaders: true });
  const dictValue = (from: Plist, key: Plist) => add("getvalueforkey", { WFInput: attachment(from), WFDictionaryKey: key });
  const setVar = (name: string, from: Plist) => add("setvariable", { WFVariableName: name, WFInput: attachment(from) }, false);
  const notify = (body: Plist) => add("notification", { WFNotificationActionBody: body, WFNotificationActionSound: true }, false);
  const choose = (from: Plist, prompt: string, multiple: boolean) => add("choosefromlist", { WFInput: attachment(from), WFChooseFromListActionPrompt: prompt, WFChooseFromListActionSelectMultiple: multiple, WFChooseFromListActionSelectAll: false });
  const group = (id: string, mode: number, gid: string, extra: { [k: string]: Plist } = {}) => add(id, { GroupingIdentifier: gid, WFControlFlowMode: mode, ...extra });
  const ifHasValue = (gid: string, what: Plist) => group("conditional", START, gid, { WFCondition: CONDITION_HAS_VALUE, WFInput: { Type: "Variable", Variable: attachment(what) } });
  /** The Shortcut's own error handling: when the answer carries `error`, show its `message` and stop. */
  const stopOnError = (answer: string, gid: string) => {
    const err = dictValue(output(answer, "Contents of URL"), "error");
    ifHasValue(gid, output(err, "Dictionary Value"));
    const msg = dictValue(output(answer, "Contents of URL"), "message");
    notify(text([output(msg, "Dictionary Value")]));
    add("exit", {}, false);
    group("conditional", END, gid);
  };

  // 0. The token: an import question fills this in when the Shortcut is installed.
  const token = add("gettext", { WFTextActionText: "", CustomOutputName: "Token" });
  // 1. One call: the rehearsal on now with its songs, or the list of rehearsals around today.
  const now = get(`${base}/api/shortcut/now`, token);
  stopOnError(now, uuid(1001));
  // 2. A rehearsal is on: take it and its songs. Otherwise ask which rehearsal, then fetch its songs.
  const reh = dictValue(output(now, "Contents of URL"), "rehearsal");
  const branch = uuid(1002);
  ifHasValue(branch, output(reh, "Dictionary Value"));
  {
    const id = dictValue(output(reh, "Dictionary Value"), "id");
    setVar("Rehearsal ID", output(id, "Dictionary Value"));
    const songs = dictValue(output(now, "Contents of URL"), "songs");
    setVar("Songs", output(songs, "Dictionary Value"));
  }
  group("conditional", OTHERWISE, branch);
  {
    const list = dictValue(output(now, "Contents of URL"), "rehearsals");
    const labels = dictValue(output(list, "Dictionary Value"), "labels");
    const chosen = choose(output(labels, "Dictionary Value"), "Which rehearsal?", false);
    const ids = dictValue(output(list, "Dictionary Value"), "ids");
    const id = dictValue(output(ids, "Dictionary Value"), text([output(chosen, "Chosen Item")]));
    setVar("Rehearsal ID", output(id, "Dictionary Value"));
    const songsAnswer = get(text([`${base}/api/shortcut/rehearsals/`, variable("Rehearsal ID"), "/songs"]), token);
    stopOnError(songsAnswer, uuid(1003));
    const songs = dictValue(output(songsAnswer, "Contents of URL"), "songs");
    setVar("Songs", output(songs, "Dictionary Value"));
  }
  group("conditional", END, branch);
  // 3. Which songs (one memo often holds a run of them): their ids, comma-separated.
  const songLabels = dictValue(variable("Songs"), "labels");
  const picked = choose(output(songLabels, "Dictionary Value"), "Which songs? (pick every song in this memo)", true);
  const loop = uuid(1004);
  group("repeat.each", START, loop, { WFInput: attachment(output(picked, "Chosen Item")) });
  const songIds = dictValue(variable("Songs"), "ids");
  dictValue(output(songIds, "Dictionary Value"), text([variable("Repeat Item")]));
  const loopEnd = group("repeat.each", END, loop);
  const joined = add("text.combine", { text: attachment(output(loopEnd, "Repeat Results")), WFTextSeparator: "Custom", WFTextCustomSeparator: "," });
  setVar("Song IDs", output(joined, "Combined Text"));
  // 4. Upload the memo, then say what happened: the answer's `message` reads "Uploaded … to …" or "Upload failed: …".
  const upload = add("downloadurl", {
    WFURL: text([`${base}/api/rehearsals/`, variable("Rehearsal ID"), "/recording"]),
    WFHTTPMethod: "POST", WFHTTPHeaders: header(token), Advanced: true, ShowHeaders: true,
    WFHTTPBodyType: "Form",
    // A File item's value is an attachment inside a parameter state (a bare attachment makes Shortcuts crash on import).
    WFFormValues: fields([field("songIds", text([variable("Song IDs")])), field("file", { Value: attachment(shortcutInput), WFSerializationType: "WFTokenAttachmentParameterState" }, FIELD_FILE)]),
  });
  const result = dictValue(output(upload, "Contents of URL"), "message");
  notify(text([output(result, "Dictionary Value")]));

  const importQuestions = [{ ActionIndex: 0, Category: "Parameter", ParameterKey: "WFTextActionText", Text: TOKEN_QUESTION, DefaultValue: "" }];
  return {
    WFWorkflowName: SHORTCUT_NAME,
    WFWorkflowClientVersion: "4018.0.4",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 4282601983, WFWorkflowIconGlyphNumber: 59511 },
    WFWorkflowTypes: ["ActionExtension"],
    WFQuickActionSurfaces: [],
    WFWorkflowInputContentItemClasses: ["WFGenericFileContentItem", "WFAVAssetContentItem"],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowHasOutputFallback: false,
    WFWorkflowImportQuestions: importQuestions,
    WFWorkflowActions: actions as unknown as Plist[],
  };
}

/* ---- XML plist ---- */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function plist(v: Plist, depth: number): string {
  const pad = "\t".repeat(depth);
  if (typeof v === "string") return `${pad}<string>${esc(v)}</string>\n`;
  if (typeof v === "boolean") return `${pad}<${v}/>\n`;
  if (typeof v === "number") return Number.isInteger(v) ? `${pad}<integer>${v}</integer>\n` : `${pad}<real>${v}</real>\n`;
  if (Array.isArray(v)) return v.length === 0 ? `${pad}<array/>\n` : `${pad}<array>\n${v.map((x) => plist(x, depth + 1)).join("")}${pad}</array>\n`;
  const keys = Object.keys(v);
  if (keys.length === 0) return `${pad}<dict/>\n`;
  return `${pad}<dict>\n${keys.map((k) => `${pad}\t<key>${esc(k)}</key>\n${plist(v[k], depth + 1)}`).join("")}${pad}</dict>\n`;
}
