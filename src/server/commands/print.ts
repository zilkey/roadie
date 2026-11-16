import { z } from "zod";
import { PrintOptions } from "@/schema/print";
import { defaultPrintOptions, keepFields, printPath } from "@/lib/print";
import { artistPath } from "@/lib/routes";
import { appUrl } from "../availability";
import { db } from "../db";
import { AppError } from "../errors";
import { printPrefs } from "../prefs";
import { callerArtistId } from "../venues";
import { defineCommand } from "./types";
import { driveClient } from "../integrations";
import { bandmates, chartsFolderId } from "../music";
import { buildSetlistPdf, saveSetlistPdf } from "../setlistPdf";
import { NO_CHARTS_FOLDER } from "./music";
import { showFolderName } from "./showPosters";

/** Sets = the flat list split at breaks: the breaks between songs + 1, or 0 for an empty list. */
function setCount(items: { type?: string }[]): number {
  let sets = 0, open = false;
  for (const i of items) {
    if (i.type === "break") { if (open) sets++; open = false; } else open = true;
  }
  return sets + (open ? 1 : 0);
}

export const setlistsPrintLink = defineCommand({
  name: "setlists.printLink",
  roles: ["admin", "member", "mcp"],
  description:
    "Get a link to the print page for a setlist template (setlistId) or a show's setlist (showId): exactly one. It only builds the link; nothing is printed, " +
    "so never say you printed it: give the person the link (or the Print button) and let them press Print. For \"tonight's setlist\", call context.now first, find today's show and pass its id as showId. " +
    "Options left out come from the caller's saved print choices, then the defaults. copy: band|mine; sheets: one|perSet; titles: wrap|short; header: boolean; transitions: boolean (set lengths count the show's song-to-song transitions; default true); paper: letter|a4. " +
    "fields lists the extra columns to show: \"key\", \"length\", \"tempo\", \"breaks\", \"alts\" (alternate songs, printed small under the song they're pinned to), \"transitions\" (what changes from the song above in the printed song fields, plus the band's transition notes, printed small above each song), or \"field:<songFieldId>\" for a custom song field marked inSetlists (ids are in records.get artists, songFields). " +
    "Returns {url (absolute), path, options}.",
  input: z.strictObject({
    setlistId: z.string().min(1).optional(), showId: z.string().min(1).optional(),
    ...PrintOptions.partial().shape,
  }).refine((i) => !!i.setlistId !== !!i.showId, "Give exactly one of setlistId or showId"),
  async run(ctx, { setlistId, showId, ...explicit }) {
    const artistId = await callerArtistId(ctx);
    const artist = artistId ? await db.get("artists", artistId) : null;
    if (!artist || artist.deletedAt || typeof artist.slug !== "string") throw new AppError("invalid_input", "Which artist? Open one first", 400);
    const id = (setlistId ?? showId)!;
    const doc = setlistId ? await db.get("setlistTemplates", id) : await db.get("setlists", id);
    if (!doc || doc.deletedAt) throw new AppError("not_found", setlistId ? `Setlist template ${id} not found` : `Show ${id} has no setlist`, 404);
    if (showId) {
      const show = await db.get("shows", id);
      if (!show || show.deletedAt || (show.artistId && show.artistId !== artistId)) throw new AppError("not_found", `Show ${id} not found`, 404);
    }
    const saved = await printPrefs(ctx.uid, artistId!);
    const defined = Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined));
    const merged = defaultPrintOptions(setCount((doc.items ?? []) as { type?: string }[]), { ...saved, ...defined });
    // Only fields that still print: song fields deleted or taken off "In setlists" since they were saved are dropped.
    const offered = ((artist.songFields ?? []) as { id: string; inSetlists?: boolean }[]).filter((f) => f.inSetlists).map((f) => f.id);
    const options = PrintOptions.parse({ ...merged, fields: keepFields(merged.fields, offered) });
    const path = artistPath(artist.slug, printPath(id, options));
    return { url: `${appUrl()}${path}`, path, options };
  },
});

export const setlistsPdf = defineCommand({
  name: "setlists.pdf",
  roles: ["admin", "member"],
  description:
    "Make one PDF of the charts for a setlist template (setlistId) or a show's setlist (showId): exactly one. Each song's Google Doc chart is exported by Google, one page per song in set order " +
    "(one page per tab of a doc with tabs; the first page only of a longer chart), a song's alternates after it. Saved in the Setlists folder inside the Charts folder, named after the show " +
    "(\"{date} {venue}.pdf\") or the template, replacing the last one by that name. Returns {url, name, folder: {name, url}, pages: [{title, tab?, alt?}], skipped: [{title, reason, alt?}]}.",
  input: z.strictObject({ setlistId: z.string().min(1).optional(), showId: z.string().min(1).optional() })
    .refine((i) => !!i.setlistId !== !!i.showId, "Give exactly one of setlistId or showId"),
  async run(ctx, { setlistId, showId }) {
    const artistId = await callerArtistId(ctx);
    const id = (setlistId ?? showId)!;
    const doc = setlistId ? await db.get("setlistTemplates", id) : await db.get("setlists", id);
    if (!doc || doc.deletedAt) throw new AppError("not_found", setlistId ? `Setlist template ${id} not found` : `Show ${id} has no setlist`, 404);
    let title = String(doc.name ?? "Setlist");
    if (showId) {
      const show = await db.get("shows", id);
      if (!show || show.deletedAt || (show.artistId && show.artistId !== artistId)) throw new AppError("not_found", `Show ${id} not found`, 404);
      title = showFolderName(show as never);
    }
    const parent = await chartsFolderId(artistId ?? undefined);
    if (!parent) throw new AppError("no_charts_folder", NO_CHARTS_FOLDER, 400);
    const drive = driveClient({ artistId: artistId ?? undefined });
    const files = (await db.list("files")).filter((f) => f.songId);
    const pdf = await buildSetlistPdf(drive, (doc.items ?? []) as never, files, title);
    if (!pdf.pages.length) throw new AppError("no_charts", "None of these songs has a Google Doc or PDF chart the band's Google account can open, so there is nothing to put in a PDF", 400);
    const name = `${title.replace(/[/\\]/g, "-").trim()}.pdf`;
    const { file, folder } = await saveSetlistPdf(drive, parent, name, pdf.bytes, (await bandmates()).map((m) => m.email));
    return { url: file.webViewLink, name: file.name, folder: { name: folder.name, url: folder.webViewLink }, pages: pdf.pages, skipped: pdf.skipped };
  },
});

export const printCommands = [setlistsPrintLink, setlistsPdf];
