/**
 * Rehearsal recordings that arrive through Drive (the rehearsal's folder) and the iOS Shortcut that sends voice memos
 * there. Uploads themselves go through /api/rehearsals/{id}/recording (multipart), not a command.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { adoptRecording, ensureRehearsalFolder, newRecordings } from "../recordings";
import { createShortcutToken, liveShortcutToken, revokeShortcutTokens } from "../shortcut";
import { appUrl } from "@/lib/app-url";

const artistOf = (ctx: Ctx) => {
  if (!ctx.artistId) throw new AppError("artist_required", "Say which artist this is for", 400);
  return ctx.artistId;
};

export const rehearsalsFolder = defineCommand({
  name: "rehearsals.folder", roles: ["admin", "mcp"],
  description: "The rehearsal's Drive folder (\"{date} Rehearsal\" inside the rehearsal recordings folder), made and shared with the band if it isn't there yet: where to drop recordings from the Drive app.",
  input: z.strictObject({ id: z.string().min(1) }),
  run: (ctx, { id }) => ensureRehearsalFolder(ctx, id),
});

export const rehearsalsNewRecordings = defineCommand({
  name: "rehearsals.newRecordings", roles: ["admin", "mcp"],
  description: "Read-only: audio and video files in the rehearsal's Drive folder that aren't attached to it yet (dropped there by hand), oldest first. folder is null when the rehearsal has no folder.",
  input: z.strictObject({ id: z.string().min(1) }),
  run: (ctx, { id }) => newRecordings(ctx, id),
});

export const rehearsalsAdoptRecording = defineCommand({
  name: "rehearsals.adoptRecording", roles: ["admin", "mcp"],
  description: "Make a file in the rehearsal's Drive folder the recording of a song at that rehearsal: renamed to \"{song} - {date} Rehearsal\", shared with the band, attached to the song and the rehearsal.",
  input: z.strictObject({ id: z.string().min(1), songId: z.string().min(1), driveFileId: z.string().min(1) }),
  run: (ctx, { id, songId, driveFileId }) => adoptRecording(ctx, id, songId, driveFileId),
});

async function shortcutStatus(ctx: Ctx) {
  const artistId = artistOf(ctx);
  const [artist, token] = await Promise.all([db.get("artists", artistId), liveShortcutToken(ctx)]);
  return {
    installUrl: (artist?.shortcutUrl as string | undefined) ?? null,
    token: token ? { createdAt: token.createdAt.toDate().toISOString(), lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toDate().toISOString() : null } : null,
    /** What the Shortcut calls: shown on the settings page for whoever builds it. */
    endpoints: { now: `${appUrl()}/api/shortcut/now`, rehearsals: `${appUrl()}/api/shortcut/rehearsals`, songs: `${appUrl()}/api/shortcut/rehearsals/{rehearsalId}/songs`, upload: `${appUrl()}/api/rehearsals/{rehearsalId}/recording` },
  };
}

export const shortcutStatusCmd = defineCommand({
  name: "shortcut.status", roles: ["admin"], input: z.strictObject({}),
  description: "Read-only: the band's Shortcut install link, whether the caller has a live shortcut token (when made, last used), and the URLs the Shortcut calls.",
  run: (ctx) => shortcutStatus(ctx),
});

export const shortcutCreateToken = defineCommand({
  name: "shortcut.createToken", roles: ["admin"], input: z.strictObject({}),
  description: "Make the caller a new shortcut token (rsk_…) for this artist and return it once as newToken; their previous one stops working. Type it into the Shortcut when installing it.",
  async run(ctx) {
    artistOf(ctx);
    const { token } = await createShortcutToken(ctx);
    return { ...(await shortcutStatus(ctx)), newToken: token };
  },
});

export const shortcutRevokeToken = defineCommand({
  name: "shortcut.revokeToken", roles: ["admin"], input: z.strictObject({}),
  description: "Revoke the caller's shortcut token for this artist; the Shortcut stops working until a new one is made.",
  async run(ctx) {
    artistOf(ctx);
    const revoked = await revokeShortcutTokens(ctx);
    return { revoked, ...(await shortcutStatus(ctx)) };
  },
});

export const shortcutSetInstallUrl = defineCommand({
  name: "shortcut.setInstallUrl", roles: ["admin"],
  description: "Save (or clear, with null) the iCloud link that installs the band's Shortcut; Settings > Google shows it as the Install button.",
  input: z.strictObject({ url: z.string().trim().url().nullable() }),
  async run(ctx, { url }) {
    const artistId = artistOf(ctx);
    if (url && !/^https:\/\/www\.icloud\.com\/shortcuts\//.test(url)) throw new AppError("invalid_input", "Use the Shortcut's iCloud link (https://www.icloud.com/shortcuts/…)", 400);
    await db.update(ctx, "artists", artistId, { shortcutUrl: url });
    return shortcutStatus(ctx);
  },
});

export const recordingCommands = [rehearsalsFolder, rehearsalsNewRecordings, rehearsalsAdoptRecording, shortcutStatusCmd, shortcutCreateToken, shortcutRevokeToken, shortcutSetInstallUrl];
