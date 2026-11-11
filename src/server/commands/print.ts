import { z } from "zod";
import { PrintOptions } from "@/schema/print";
import { defaultPrintOptions, printPath } from "@/lib/print";
import { artistPath } from "@/lib/routes";
import { appUrl } from "../availability";
import { db } from "../db";
import { AppError } from "../errors";
import { printPrefs } from "../prefs";
import { callerArtistId } from "../venues";
import { defineCommand } from "./types";

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
    "fields lists the extra columns to show: \"key\", \"length\", \"breaks\", \"alts\" (alternate songs, printed small under the song they're pinned to), or \"field:<songFieldId>\" for a custom song field (ids are in records.get artists, songFields). " +
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
    const options = PrintOptions.parse(defaultPrintOptions(setCount((doc.items ?? []) as { type?: string }[]), { ...saved, ...defined }));
    const path = artistPath(artist.slug, printPath(id, options));
    return { url: `${appUrl()}${path}`, path, options };
  },
});

export const printCommands = [setlistsPrintLink];
