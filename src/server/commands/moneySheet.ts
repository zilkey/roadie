/**
 * The Money sheet (Settings › Google › Money sheet, and Send to sheet on Money). Personal: each admin chooses their own
 * Google Sheet and whose money goes in it; sends run as their own Google account. Named google.* so Roadie (the assistant)
 * never offers them: they write to someone's own Drive (src/server/assistant/policy.ts EXCLUDED).
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { appUrl } from "@/lib/app-url";
import { showName } from "@/lib/shows";
import { defaultProject } from "@/lib/money";
import { moneySheetTables, spreadsheetIdFrom, type MoneySheetInput, type SheetBlank } from "@/lib/moneySheet";
import { getGrant } from "../google/grants";
import { IntegrationError, useRealGoogle } from "../integrations";
import { sheetsClient, type SheetsInfo } from "../integrations/sheets";
import { moneySheetPref, setMoneySheetPref, writeTable, type MoneySheetPref } from "../moneySheet";

const artistOf = (ctx: Ctx) => {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
};
/** The caller's own Google can reach Sheets: the local fake (DRIVE_BASE_URL set), or the real API with their own Drive grant. */
async function sheetsReady(uid: string): Promise<boolean> {
  if (!useRealGoogle(process.env.DRIVE_BASE_URL)) return !!process.env.DRIVE_BASE_URL;
  return !!(await getGrant(uid))?.features.includes("drive");
}
const sheetsError = (e: unknown): never => {
  if (e instanceof IntegrationError) {
    // Google answers 403 both for "not an editor" and for an API that isn't turned on in the OAuth client's Cloud project.
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(e.message)) {
      throw new AppError("sheets_disabled", "The Google Sheets API isn't turned on for Roadie's Google Cloud project yet. Turn it on in the Cloud Console (APIs & Services › Library › Google Sheets API), then send again.", 503);
    }
    if (e.status === 404) throw new AppError("not_found", "Your Google account can't open that sheet. Check the link, or ask its owner to share it with you as an editor.", 404);
    if (e.status === 403) throw new AppError("forbidden", "Your Google account can't change that sheet. Ask its owner to make you an editor.", 403);
    throw new AppError("sheets_error", `Google Sheets: ${e.message}`, 502);
  }
  throw e;
};
const view = (p: MoneySheetPref | null) => p && { title: p.title, url: p.url, whose: p.whose, sentAt: p.sentAt ?? null, sentIncome: p.sentIncome ?? null, sentExpenses: p.sentExpenses ?? null };
async function status(ctx: Ctx) {
  const artistId = artistOf(ctx);
  const [ready, pref] = await Promise.all([sheetsReady(ctx.uid), moneySheetPref(ctx.uid, artistId)]);
  return { ready, sheet: view(pref) };
}

export const googleMoneySheet = defineCommand({
  name: "google.moneySheet", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: the caller's own Money sheet for this artist (title, link, whose money, last send) and whether their Google account can write to Sheets.",
  run: (ctx) => status(ctx),
});

export const googleSetMoneySheet = defineCommand({
  name: "google.setMoneySheet", roles: ["admin"],
  description: "Choose the caller's own Money sheet (a Google Sheets link or id they can edit) and/or whose money goes in it: mine (what they received, paid or bore, like their Taxes page) or band (everything). Nothing is written to the sheet until Send to sheet.",
  input: z.strictObject({ sheet: z.string().trim().min(1).optional(), whose: z.enum(["mine", "band"]).optional() }),
  async run(ctx, i) {
    const artistId = artistOf(ctx);
    const cur = await moneySheetPref(ctx.uid, artistId);
    if (!i.sheet && !cur) throw new AppError("invalid_input", "Paste the Google Sheet's link first", 400);
    let next: MoneySheetPref = cur ?? { spreadsheetId: "", title: "", url: "", whose: "mine" };
    if (i.sheet) {
      const id = spreadsheetIdFrom(i.sheet);
      if (!id) throw new AppError("invalid_input", "That doesn't look like a Google Sheets link", 400);
      if (!(await sheetsReady(ctx.uid))) throw new AppError("drive_not_connected", "Connect your Google account with Drive first (Your Google account, above)", 400);
      const info: SheetsInfo = await sheetsClient({ uid: ctx.uid }).info(id).catch(sheetsError);
      if (!info.canEdit) throw new AppError("forbidden", `You can only view ${info.title}. Ask its owner to make you an editor.`, 403);
      // A different sheet starts clean: the old one's tables are not this one's.
      next = id === cur?.spreadsheetId ? { ...next, title: info.title, url: info.url } : { spreadsheetId: id, title: info.title, url: info.url, whose: next.whose };
    }
    if (i.whose) next = { ...next, whose: i.whose };
    await setMoneySheetPref(ctx.uid, artistId, next);
    return status(ctx);
  },
});

export const googleClearMoneySheet = defineCommand({
  name: "google.clearMoneySheet", roles: ["admin"], input: z.strictObject({}),
  description: "Stop using the caller's Money sheet. The sheet and its Roadie tabs stay as they are in Google Sheets.",
  async run(ctx) {
    await setMoneySheetPref(ctx.uid, artistOf(ctx), null);
    return status(ctx);
  },
});

/** Everything the two tables are built from, for one artist. */
async function sheetInput(ctx: Ctx, artistId: string, pref: MoneySheetPref): Promise<MoneySheetInput> {
  const byArtist = (q: FirebaseFirestore.Query) => q.where("artistId", "==", artistId);
  const [artist, income, payouts, projects, shows, expenses, users, musicians] = await Promise.all([
    db.get("artists", artistId), db.list("income", byArtist), db.list("payouts", byArtist), db.list("projects", byArtist), db.list("shows", byArtist),
    db.list("expenses"), db.list("users"), db.list("musicians"),
  ]);
  const projectIds = new Set(projects.map((p) => p.id));
  const def = defaultProject(projects as unknown as { id: string; kind: string; name: string; status: string; isDefault?: boolean }[]);
  const name = (uid: string) => (users.find((u) => u.id === uid)?.name as string | undefined) ?? (musicians.find((m) => m.userId === uid)?.name as string | undefined) ?? "Someone";
  return {
    whose: pref.whose, uid: ctx.uid,
    income: income as unknown as MoneySheetInput["income"],
    payouts: payouts as unknown as MoneySheetInput["payouts"],
    // Expenses carry no artistId: theirs are the ones on this artist's projects (or on none, which is the default project).
    expenses: expenses.filter((x) => !x.projectId || projectIds.has(x.projectId as string)) as unknown as MoneySheetInput["expenses"],
    shows: shows.map((s) => ({ id: s.id, date: s.date as string | undefined, name: showName(s as Parameters<typeof showName>[0]) })),
    projects: projects.map((p) => ({ id: p.id, name: p.name as string })),
    defaultProjectId: def?.id,
    personName: name,
    musicianUserId: (mid) => musicians.find((m) => m.id === mid)?.userId as string | undefined,
    base: `${appUrl()}/artists/${artist?.slug as string}`,
  };
}

export const googleSendMoneySheet = defineCommand({
  name: "google.sendMoneySheet", roles: ["admin"], input: z.strictObject({}),
  description: "Send to sheet: rewrite the Roadie income and Roadie expenses tables in the caller's Money sheet from Money, in full (rows typed in those two tabs are replaced). " +
    "Returns the row counts and the rows that went out with blanks a formula may need (income with no method; with whose=mine, received income nobody is down as receiving).",
  async run(ctx) {
    const artistId = artistOf(ctx);
    const pref = await moneySheetPref(ctx.uid, artistId);
    if (!pref?.spreadsheetId) throw new AppError("no_money_sheet", "Choose your Money sheet on Settings › Google first", 400);
    if (!(await sheetsReady(ctx.uid))) throw new AppError("drive_not_connected", "Connect your Google account with Drive on Settings › Google first", 400);
    const t = moneySheetTables(await sheetInput(ctx, artistId, pref));
    const svc = sheetsClient({ uid: ctx.uid });
    const income = await writeTable(svc, pref.spreadsheetId, t.income, pref.income).catch(sheetsError);
    const expenses = await writeTable(svc, pref.spreadsheetId, t.expenses, pref.expenses).catch(sheetsError);
    const sentAt = (ctx.now ?? new Date()).toISOString();
    const next: MoneySheetPref = { ...pref, income, expenses, sentAt, sentIncome: t.income.rows.length, sentExpenses: t.expenses.rows.length };
    await setMoneySheetPref(ctx.uid, artistId, next);
    const blanks: SheetBlank[] = t.blanks;
    return { ...(await status(ctx)), income: t.income.rows.length, expenses: t.expenses.rows.length, blanks };
  },
});

export const moneySheetCommands = [googleMoneySheet, googleSetMoneySheet, googleClearMoneySheet, googleSendMoneySheet];
