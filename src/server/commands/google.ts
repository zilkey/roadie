/**
 * Connecting Google (Settings > Google). Each admin connects their own Google account for the features they pick
 * (Gmail, Calendar, Drive). The flow: google.connectUrl gives the Google consent URL with a signed state; Google sends
 * the browser to /api/google/callback, which forwards code and state to the Settings page; the page calls
 * google.finishConnect as the signed-in admin, which checks the state is theirs and stores the grant (src/server/google).
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { authUrl, emailFromIdToken, exchangeCode, featuresOf, googleConfigured, GOOGLE_FEATURES, GoogleAuthError, revoke, safeReturnTo, signState, verifyState } from "../google/oauth";
import { getGrant, removeGrant, saveGrant, type Grant } from "../google/grants";
import { bandGoogle } from "../google/band";
import { calendarClient, canWrite, driveClient, IntegrationError, useRealGoogle, type CalInfo } from "../integrations";
import { FOLDER_MIME } from "../integrations/drive";

const artistOf = (ctx: Ctx) => {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
};
const usableForBand = (g: Grant | null) => !!g && (g.features.includes("calendar") || g.features.includes("drive"));


/** A folder id from what an admin pastes: a Drive folder link (…/folders/{id}, …?id={id}) or the bare id. */
export function folderIdFrom(v: string): string | null {
  const s = v.trim();
  const m = /\/folders\/([\w-]+)/.exec(s) ?? /[?&]id=([\w-]+)/.exec(s);
  if (m) return m[1];
  return /^[\w-]{3,}$/.test(s) ? s : null;
}

/** Drive works for this artist: the local fake (DRIVE_BASE_URL set), or the real API with a band account that connected Drive. */
async function driveReady(artistId: string): Promise<boolean> {
  if (!useRealGoogle(process.env.DRIVE_BASE_URL)) return !!process.env.DRIVE_BASE_URL;
  const band = await bandGoogle(artistId);
  return !!band && !!(await getGrant(band.uid))?.features.includes("drive");
}

/** A chosen folder (band or rehearsal recordings) as Drive sees it now (its name can change there), or why Drive can't show it. */
async function folderStatus(artistId: string, field: "driveFolderId" | "rehearsalFolderId" | "chartsFolderId" | "demosFolderId" | "songwritingFolderId" | "showsFolderId" | "releasesFolderId" | "postsFolderId") {
  const id = (await db.get("artists", artistId))?.[field] as string | undefined;
  if (!id) return null;
  try {
    const f = await driveClient({ artistId }).get(id);
    return { id, name: f.name, url: f.webViewLink };
  } catch (e) {
    return { id, name: null, url: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The caller can use Calendar: the local fake (CALENDAR_BASE_URL set), or the real API with their own grant for Calendar. */
async function calendarReady(uid: string): Promise<boolean> {
  if (!useRealGoogle(process.env.CALENDAR_BASE_URL)) return !!process.env.CALENDAR_BASE_URL;
  return !!(await getGrant(uid))?.features.includes("calendar");
}
const bandCalendarOf = async (artistId: string) => ((await db.get("artists", artistId))?.calendar as { id: string; name: string } | null | undefined) ?? null;

/** The caller's own access to a calendar, as their Google account sees it. */
async function accessTo(uid: string, calendarId: string): Promise<CalInfo | null> {
  try { return await calendarClient({ uid }).calendar(calendarId); } catch (e) {
    if (e instanceof IntegrationError && e.status === 404) return null;
    if (e instanceof IntegrationError) throw new AppError("calendar_error", `Google Calendar: ${e.message}`, 502);
    throw e;
  }
}

async function status(ctx: Ctx) {
  const artistId = artistOf(ctx);
  const [ready, folder, rehearsalFolder, chartsFolder, demosFolder, songwritingFolder, showsFolder, releasesFolder, postsFolder, calReady, calendar] = await Promise.all([
    driveReady(artistId), folderStatus(artistId, "driveFolderId"), folderStatus(artistId, "rehearsalFolderId"), folderStatus(artistId, "chartsFolderId"), folderStatus(artistId, "demosFolderId"),
    folderStatus(artistId, "songwritingFolderId"), folderStatus(artistId, "showsFolderId"), folderStatus(artistId, "releasesFolderId"), folderStatus(artistId, "postsFolderId"),
    calendarReady(ctx.uid), bandCalendarOf(artistId),
  ]);
  const cal = { calendarReady: calReady, calendar };
  if (!googleConfigured()) return { configured: false, me: null, band: null, driveReady: ready, bandFolder: folder, rehearsalFolder, chartsFolder, demosFolder, songwritingFolder, showsFolder, releasesFolder, postsFolder, ...cal };
  // Set up, but a *_BASE_URL still points this service at its local fake (e.g. .env.development).
  const fakes = (["gmail", "calendar", "drive"] as const).filter((f) => !!process.env[`${f.toUpperCase()}_BASE_URL`]);
  const [me, band] = await Promise.all([getGrant(ctx.uid), bandGoogle(artistId)]);
  const [bandUser, bandGrant] = band ? await Promise.all([db.get("users", band.uid), getGrant(band.uid)]) : [null, null];
  return {
    configured: true, fakes, driveReady: ready, bandFolder: folder, rehearsalFolder, chartsFolder, demosFolder, songwritingFolder, showsFolder, releasesFolder, postsFolder, ...cal,
    me: me ? { googleEmail: me.googleEmail, features: me.features } : null,
    band: band ? { email: band.email, name: (bandUser?.name as string | undefined) ?? band.email, isMe: band.uid === ctx.uid, features: bandGrant?.features ?? [] } : null,
  };
}

export const googleStatus = defineCommand({
  name: "google.status", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: whether Google is set up on this server, which features the caller's own Google account is connected for, which admin's account the band's Drive uses, and the band calendar.",
  run: (ctx) => status(ctx),
});

export const googleConnectUrl = defineCommand({
  name: "google.connectUrl", roles: ["admin"],
  description: "The Google consent page URL for connecting the caller's own Google account for the chosen features (gmail, calendar, drive). Adds to what they connected before.",
  input: z.strictObject({ features: z.array(z.enum(GOOGLE_FEATURES)).min(1), returnTo: z.string().optional() }),
  async run(ctx, { features, returnTo }) {
    const artistId = artistOf(ctx);
    if (!googleConfigured()) throw new AppError("google_not_configured", "Google isn't set up on this server", 503);
    const [artist, user] = await Promise.all([db.get("artists", artistId), db.get("users", ctx.uid)]);
    if (!artist) throw new AppError("not_found", "Artist not found", 404);
    const state = signState({ uid: ctx.uid, artistId, slug: artist.slug as string, features: [...new Set(features)], returnTo: safeReturnTo(returnTo) });
    return { url: authUrl(state, [...new Set(features)], user?.email as string | undefined) };
  },
});

export const googleFinishConnect = defineCommand({
  name: "google.finishConnect", roles: ["admin"],
  description: "Finish connecting Google: exchange the code Google returned and store the caller's grant. The state must be one this admin started. " +
    "The first account connected for Calendar or Drive becomes the band's Drive account.",
  input: z.strictObject({ code: z.string().min(1), state: z.string().min(1) }),
  async run(ctx, { code, state }) {
    const artistId = artistOf(ctx);
    const s = verifyState(state);
    if (!s || s.uid !== ctx.uid || s.artistId !== artistId) throw new AppError("invalid_state", "That Google sign-in link has expired or isn't yours. Try Connect again.", 400);
    const user = await db.get("users", ctx.uid);
    if (!user) throw new AppError("forbidden", "No user for this account", 403);
    let t;
    try { t = await exchangeCode(code); } catch (e) {
      if (e instanceof GoogleAuthError) throw new AppError("google_error", `Google: ${e.message}`, 502);
      throw e;
    }
    const googleEmail = emailFromIdToken(t.id_token) ?? (user.email as string);
    const grant = await saveGrant(ctx.uid, user.email as string, googleEmail, t);
    const missing = s.features.filter((f) => !featuresOf(t.scope.split(" ")).includes(f));
    if (usableForBand(grant) && !(await bandGoogle(artistId))) await db.update(ctx, "artists", artistId, { google: { uid: ctx.uid, email: grant.googleEmail } });
    return { ...(await status(ctx)), missing };
  },
});

export const googleUseForBand = defineCommand({
  name: "google.useForBand", roles: ["admin"], input: z.strictObject({}),
  description: "Make the caller's connected Google account the band's for Drive: Drive lookups, sharing checks and copies use their Drive. (Calendar events go on the band calendar, google.setCalendar.)",
  async run(ctx) {
    const artistId = artistOf(ctx);
    const g = await getGrant(ctx.uid);
    if (!usableForBand(g)) throw new AppError("invalid_input", "Connect your Google Calendar or Drive first", 400);
    await db.update(ctx, "artists", artistId, { google: { uid: ctx.uid, email: g!.googleEmail } });
    return status(ctx);
  },
});

export const googleDisconnect = defineCommand({
  name: "google.disconnect", roles: ["admin"], input: z.strictObject({}),
  description: "Disconnect the caller's Google account: revoke Roadie's access at Google and forget the grant. If it was the band's account, the band has none until another admin connects.",
  async run(ctx) {
    artistOf(ctx);
    const token = await removeGrant(ctx.uid);
    if (token) await revoke(token);
    // Every artist whose band account this was loses it, not only the one the caller is in.
    for (const a of await db.list("artists")) {
      if ((a.google as { uid?: string } | null | undefined)?.uid === ctx.uid) await db.update({ ...ctx, artistId: a.id }, "artists", a.id, { google: null });
    }
    return status(ctx);
  },
});

export const googleFindFolders = defineCommand({
  name: "google.findFolders", roles: ["admin"],
  description: "Read-only: folders in the band's Google Drive whose name contains q, for choosing the band folder.",
  input: z.strictObject({ q: z.string().trim().min(1) }),
  async run(ctx, { q }) {
    const artistId = artistOf(ctx);
    if (!(await driveReady(artistId))) throw new AppError("drive_not_connected", "Connect Drive on the band's Google account first", 400);
    const hits = await driveClient({ artistId }).search({ q, mimeType: FOLDER_MIME });
    return { folders: hits.slice(0, 20).map((f) => ({ id: f.id, name: f.name, url: f.webViewLink, ownerEmail: f.ownerEmail })) };
  },
});

/** The folder an admin pasted or picked, as Drive shows it to the band's Google account; refuses files and folders Drive can't find. */
export async function chosenFolder(artistId: string, folder: string) {
  const id = folderIdFrom(folder);
  if (!id) throw new AppError("invalid_input", "That isn't a Drive folder link", 400);
  if (!(await driveReady(artistId))) throw new AppError("drive_not_connected", "Connect Drive on the band's Google account first", 400);
  let f;
  try { f = await driveClient({ artistId }).get(id); } catch (e) {
    if (e instanceof IntegrationError && e.status === 404) throw new AppError("not_found", "Drive can't find that folder from the band's Google account", 404);
    throw e;
  }
  if (f.mimeType !== FOLDER_MIME) throw new AppError("invalid_input", `${f.name} is a file, not a folder`, 400);
  return f;
}

export const googleFolder = defineCommand({
  name: "google.folder", roles: ["admin"],
  description: "Read-only: a Drive folder by id or link, as the band's Google account sees it ({ id, name, url }), for picking a folder in a form.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const f = await chosenFolder(artistOf(ctx), folder);
    return { id: f.id, name: f.name, url: f.webViewLink };
  },
});

export const googleSetBandFolder = defineCommand({
  name: "google.setBandFolder", roles: ["admin"],
  description: "Choose the band folder: the shared Drive folder songs' files are checked against and copied into. Takes a folder id or a Drive folder link; Drive must show it as a folder to the band's Google account.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { driveFolderId: f.id });
    return status(ctx);
  },
});

export const googleSetRehearsalFolder = defineCommand({
  name: "google.setRehearsalFolder", roles: ["admin"],
  description: "Choose the rehearsal recordings folder: recordings uploaded on a song in a rehearsal go into a \"{date} Rehearsal\" folder inside it. Takes a folder id or a Drive folder link.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { rehearsalFolderId: f.id });
    return status(ctx);
  },
});

export const googleCalendars = defineCommand({
  name: "google.calendars", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: the calendars in the caller's own Google Calendar list and their access to each (owner and writer can add events), for choosing the band calendar.",
  async run(ctx) {
    artistOf(ctx);
    if (!(await calendarReady(ctx.uid))) throw new AppError("calendar_not_connected", "Connect your Google Calendar first", 400);
    const all = await calendarClient({ uid: ctx.uid }).calendars().catch((e) => {
      if (e instanceof IntegrationError) throw new AppError("calendar_error", `Google Calendar: ${e.message}`, 502);
      throw e;
    });
    return { calendars: all.map((c) => ({ ...c, canWrite: canWrite(c) })).sort((a, b) => Number(b.canWrite) - Number(a.canWrite) || Number(!!b.primary) - Number(!!a.primary) || a.name.localeCompare(b.name)) };
  },
});

export const googleSetCalendar = defineCommand({
  name: "google.setCalendar", roles: ["admin"],
  description: "Choose the band calendar: the shared Google Calendar show and rehearsal events go on when an admin sends them. The caller's own Google account must be able to add events to it.",
  input: z.strictObject({ calendarId: z.string().trim().min(1) }),
  async run(ctx, { calendarId }) {
    const artistId = artistOf(ctx);
    if (!(await calendarReady(ctx.uid))) throw new AppError("calendar_not_connected", "Connect your Google Calendar first", 400);
    const c = await accessTo(ctx.uid, calendarId);
    if (!c) throw new AppError("not_found", "Your Google account doesn't have that calendar", 404);
    if (!canWrite(c)) throw new AppError("forbidden", `You can only see ${c.name}, not add events to it. Ask its owner to let you make changes to events.`, 403);
    await db.update(ctx, "artists", artistId, { calendar: { id: c.id, name: c.name } });
    return status(ctx);
  },
});

export const googleCheckCalendar = defineCommand({
  name: "google.checkCalendar", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: whether the caller's own Google account can add events to the band calendar (their access role on it), so they know their show and rehearsal sends will work.",
  async run(ctx) {
    const artistId = artistOf(ctx);
    const calendar = await bandCalendarOf(artistId);
    if (!calendar) throw new AppError("calendar_not_chosen", "No band calendar yet. Choose it first.", 400);
    if (!(await calendarReady(ctx.uid))) return { calendar, canWrite: false, accessRole: null, reason: "not_connected" as const };
    const c = await accessTo(ctx.uid, calendar.id);
    return { calendar, canWrite: !!c && canWrite(c), accessRole: c?.accessRole ?? null, reason: !c ? "no_access" as const : canWrite(c) ? null : "read_only" as const };
  },
});

export const googleSetChartsFolder = defineCommand({
  name: "google.setChartsFolder", roles: ["admin"],
  description: "Choose the Charts folder: where lyrics, chord sheets and other charts go. Copy to band folder (files.copyToBand, drive.fix copy) puts its copies here. Takes a folder id or a Drive folder link.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { chartsFolderId: f.id });
    return status(ctx);
  },
});

export const googleSetDemosFolder = defineCommand({
  name: "google.setDemosFolder", roles: ["admin"],
  description: "Choose the Demos folder: where audio uploaded to a song goes. Takes a folder id or a Drive folder link.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { demosFolderId: f.id });
    return status(ctx);
  },
});

export const googleSetSongwritingFolder = defineCommand({
  name: "google.setSongwritingFolder", roles: ["admin"],
  description: "Choose the Songwriting folder: where audio uploaded to a song in the Writing phase goes. Takes a folder id or a Drive folder link.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { songwritingFolderId: f.id });
    return status(ctx);
  },
});

export const googleSetShowsFolder = defineCommand({
  name: "google.setShowsFolder", roles: ["admin"],
  description: "Choose the Shows folder: a poster uploaded to a show goes into a \"{date} {venue}\" folder inside it, made on the first upload. Takes a folder id or a Drive folder link.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { showsFolderId: f.id });
    return status(ctx);
  },
});

export const googleSetReleasesFolder = defineCommand({
  name: "google.setReleasesFolder", roles: ["admin"],
  description: "Choose the Releases folder: Create on a release makes the release's own folder inside it. Takes a folder id or a Drive folder link.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { releasesFolderId: f.id });
    return status(ctx);
  },
});

export const googleSetPostsFolder = defineCommand({
  name: "google.setPostsFolder", roles: ["admin"],
  description: "Choose the Posts folder: a photo uploaded on Posts goes into a \"{YYYY-MM}\" folder inside it, made on the month's first upload. Takes a folder id or a Drive folder link.",
  input: z.strictObject({ folder: z.string().trim().min(1) }),
  async run(ctx, { folder }) {
    const artistId = artistOf(ctx);
    const f = await chosenFolder(artistId, folder);
    await db.update(ctx, "artists", artistId, { postsFolderId: f.id });
    return status(ctx);
  },
});

export const googleCommands = [googleCalendars, googleSetCalendar, googleCheckCalendar, googleStatus, googleConnectUrl, googleFinishConnect, googleUseForBand, googleDisconnect, googleFindFolders, googleFolder, googleSetBandFolder, googleSetChartsFolder, googleSetDemosFolder, googleSetSongwritingFolder, googleSetRehearsalFolder, googleSetShowsFolder, googleSetReleasesFolder, googleSetPostsFolder];
