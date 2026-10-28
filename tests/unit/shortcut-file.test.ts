import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildShortcut, buildShortcutPlist, SHORTCUT_PATH, SHORTCUT_PLIST_PATH, TOKEN_QUESTION } from "@/lib/shortcut-file";
import { shortcutErrorResponse } from "@/server/shortcut";
import { AppError } from "@/server/errors";

const pub = path.join(__dirname, "..", "..", "public");
type Action = { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Record<string, any> };
const actionsOf = (url: string) => (buildShortcut(url) as any).WFWorkflowActions as Action[];
const ids = (as: Action[]) => as.map((a) => a.WFWorkflowActionIdentifier.replace("is.workflow.actions.", ""));

test("the built Shortcut: token question, one first call, skip-the-picker branch, multi-song pick, upload with the memo as a File, notification either way", () => {
  const doc = buildShortcut("https://app.myroadie.online/") as any;
  assert.deepEqual(doc.WFWorkflowTypes, ["ActionExtension"], "shows in the share sheet");
  assert.deepEqual(doc.WFWorkflowImportQuestions, [{ ActionIndex: 0, Category: "Parameter", ParameterKey: "WFTextActionText", Text: TOKEN_QUESTION, DefaultValue: "" }]);
  const as = doc.WFWorkflowActions as Action[];
  assert.equal(ids(as)[0], "gettext", "the token is the first action, which the import question fills");

  const calls = as.filter((a) => a.WFWorkflowActionIdentifier.endsWith("downloadurl")).map((a) => a.WFWorkflowActionParameters);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].WFURL, "https://app.myroadie.online/api/shortcut/now");
  assert.equal(calls[1].WFURL.Value.string, "https://app.myroadie.online/api/shortcut/rehearsals/￼/songs");
  assert.equal(calls[2].WFURL.Value.string, "https://app.myroadie.online/api/rehearsals/￼/recording");
  assert.deepEqual(calls[2].WFURL.Value.attachmentsByRange, { [`{${"https://app.myroadie.online/api/rehearsals/".length}, 1}`]: { Type: "Variable", VariableName: "Rehearsal ID" } });
  for (const c of calls) {
    const h = c.WFHTTPHeaders.Value.WFDictionaryFieldValueItems[0];
    assert.equal(h.WFKey.Value.string, "Authorization");
    assert.equal(h.WFValue.Value.string, "Bearer ￼");
    assert.equal(h.WFValue.Value.attachmentsByRange["{7, 1}"].OutputUUID, as[0].WFWorkflowActionParameters.UUID, "the token Text's output");
  }
  assert.deepEqual([calls[2].WFHTTPMethod, calls[2].WFHTTPBodyType], ["POST", "Form"]);
  const form = calls[2].WFFormValues.Value.WFDictionaryFieldValueItems;
  assert.deepEqual(form.map((f: any) => [f.WFKey.Value.string, f.WFItemType]), [["songIds", 0], ["file", 5]], "the memo goes as a File field (a Text field is what broke the hand-built one)");
  assert.deepEqual(form[1].WFValue.Value, { Type: "ExtensionInput" }, "the shared memo itself");

  // control flow: every If / Repeat is closed, in order
  const open: string[] = [];
  for (const a of as) {
    const p = a.WFWorkflowActionParameters;
    if (!("WFControlFlowMode" in p)) continue;
    if (p.WFControlFlowMode === 0) open.push(p.GroupingIdentifier);
    else { assert.equal(open[open.length - 1], p.GroupingIdentifier, "closes the innermost group"); if (p.WFControlFlowMode === 2) open.pop(); }
  }
  assert.deepEqual(open, []);
  const prompts = as.filter((a) => a.WFWorkflowActionIdentifier.endsWith("choosefromlist")).map((a) => [a.WFWorkflowActionParameters.WFChooseFromListActionPrompt, a.WFWorkflowActionParameters.WFChooseFromListActionSelectMultiple]);
  assert.deepEqual(prompts, [["Which rehearsal?", false], ["Which songs? (pick every song in this memo)", true]]);
  // errors from the lists stop the Shortcut with the message; the upload's answer is shown whatever it says
  assert.equal(as.filter((a) => a.WFWorkflowActionIdentifier.endsWith(".exit")).length, 2);
  assert.equal(as.filter((a) => a.WFWorkflowActionIdentifier.endsWith(".notification")).length, 3);
  const last = as[as.length - 1].WFWorkflowActionParameters;
  const msg = as[as.length - 2];
  assert.equal(msg.WFWorkflowActionParameters.WFDictionaryKey, "message");
  assert.equal(last.WFNotificationActionBody.Value.attachmentsByRange["{0, 1}"].OutputUUID, msg.WFWorkflowActionParameters.UUID);
  // every output an action refers to is an earlier action's UUID
  const seen = new Set<string>();
  for (const a of as) {
    for (const m of JSON.stringify(a.WFWorkflowActionParameters).matchAll(/"OutputUUID":"([^"]+)"/g)) assert.ok(seen.has(m[1]), `${a.WFWorkflowActionIdentifier} refers to a later action`);
    if (a.WFWorkflowActionParameters.UUID) seen.add(a.WFWorkflowActionParameters.UUID);
  }
});

test("public/shortcuts holds the current recipe, signed: rebuild with `npm run shortcut:build` after changing src/lib/shortcut-file.ts", () => {
  const plist = buildShortcutPlist("https://app.myroadie.online");
  assert.ok(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist'));
  assert.equal(fs.readFileSync(path.join(pub, SHORTCUT_PLIST_PATH), "utf8"), plist, "the committed plist is out of date");
  assert.ok(fs.statSync(path.join(pub, SHORTCUT_PATH)).size > 1000, "the signed file is there");
  assert.ok(ids(actionsOf("http://127.0.0.1:3100")).length === ids(actionsOf("https://x")).length);
});

test("shortcutErrorResponse: ok false and a one-line message for the Shortcut's notification, the usual error for the app", async () => {
  const r = shortcutErrorResponse(new AppError("invalid_input", "No recording came through", 400), "Upload failed");
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { ok: false, message: "Upload failed: No recording came through", error: { code: "invalid_input", message: "No recording came through" } });
  const log = console.error; console.error = () => {};
  try {
    const u = shortcutErrorResponse(new Error("boom"), "Roadie");
    assert.equal(u.status, 500);
    assert.equal((await u.json()).message, "Roadie: Something went wrong");
  } finally { console.error = log; }
});
