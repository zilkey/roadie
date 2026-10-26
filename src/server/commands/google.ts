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
import { authUrl, emailFromIdToken, exchangeCode, featuresOf, googleConfigured, GOOGLE_FEATURES, GoogleAuthError, revoke, signState, verifyState } from "../google/oauth";
import { getGrant, removeGrant, saveGrant, type Grant } from "../google/grants";
import { bandGoogle } from "../google/band";
import { driveClient, IntegrationError, useRealGoogle } from "../integrations";
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
async function folderStatus(artistId: string, field: "driveFolderId" | "rehearsalFolderId") {
  const id = (await db.get("artists", artistId))?.[field] as string | undefined;
  if (!id) return null;
  try {
    const f = await driveClient({ artistId }).get(id);
    return { id, name: f.name, url: f.webViewLink };
  } catch (e) {
    return { id, name: null, url: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function status(ctx: Ctx) {
  const artistId = artistOf(ctx);
  const [ready, folder, rehearsalFolder] = await Promise.all([driveReady(artistId), folderStatus(artistId, "driveFolderId"), folderStatus(artistId, "rehearsalFolderId")]);
  if (!googleConfigured()) return { configured: false, me: null, band: null, driveReady: ready, bandFolder: folder, rehearsalFolder };
  // Set up, but a *_BASE_URL still points this service at its local fake (e.g. .env.development).
  const fakes = (["gmail", "calendar", "drive"] as const).filter((f) => !!process.env[`${f.toUpperCase()}_BASE_URL`]);
  const [me, band] = await Promise.all([getGrant(ctx.uid), bandGoogle(artistId)]);
  const [bandUser, bandGrant] = band ? await Promise.all([db.get("users", band.uid), getGrant(band.uid)]) : [null, null];
  return {
    configured: true, fakes, driveReady: ready, bandFolder: folder, rehearsalFolder,
    me: me ? { googleEmail: me.googleEmail, features: me.features } : null,
    band: band ? { email: band.email, name: (bandUser?.name as string | undefined) ?? band.email, isMe: band.uid === ctx.uid, features: bandGrant?.features ?? [] } : null,
  };
}

export const googleStatus = defineCommand({
  name: "google.status", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: whether Google is set up on this server, which features the caller's own Google account is connected for, and which admin's account the band's Calendar and Drive use.",
  run: (ctx) => status(ctx),
});

export const googleConnectUrl = defineCommand({
  name: "google.connectUrl", roles: ["admin"],
  description: "The Google consent page URL for connecting the caller's own Google account for the chosen features (gmail, calendar, drive). Adds to what they connected before.",
  input: z.strictObject({ features: z.array(z.enum(GOOGLE_FEATURES)).min(1) }),
  async run(ctx, { features }) {
    const artistId = artistOf(ctx);
    if (!googleConfigured()) throw new AppError("google_not_configured", "Google isn't set up on this server", 503);
    const [artist, user] = await Promise.all([db.get("artists", artistId), db.get("users", ctx.uid)]);
    if (!artist) throw new AppError("not_found", "Artist not found", 404);
    const state = signState({ uid: ctx.uid, artistId, slug: artist.slug as string, features: [...new Set(features)] });
    return { url: authUrl(state, [...new Set(features)], user?.email as string | undefined) };
  },
});

export const googleFinishConnect = defineCommand({
  name: "google.finishConnect", roles: ["admin"],
  description: "Finish connecting Google: exchange the code Google returned and store the caller's grant. The state must be one this admin started. " +
    "The first account connected for Calendar or Drive becomes the band's.",
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
  description: "Make the caller's connected Google account the band's: new show events go on their Google Calendar and Drive lookups use their Drive. Events already on the old account's calendar stay there.",
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
async function chosenFolder(artistId: string, folder: string) {
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

export const googleCommands = [googleStatus, googleConnectUrl, googleFinishConnect, googleUseForBand, googleDisconnect, googleFindFolders, googleSetBandFolder, googleSetRehearsalFolder];
