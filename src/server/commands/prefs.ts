import { z } from "zod";
import { SectionOrderInput, SectionSetInput } from "@/schema/sections";
import { PrintOptions } from "@/schema/print";
import { AppError } from "../errors";
import { hiddenSections, printPrefs, sectionOrder, setSectionHidden, setSectionOrder, setPrintPrefs } from "../prefs";
import { callerArtistId } from "../venues";
import { defineCommand } from "./types";

export const sectionsSetHidden = defineCommand({
  name: "sections.setHidden", roles: ["admin", "member"], input: SectionSetInput,
  description: "Hide a main section (shows, booking, templates, songs, setlists, rehearsals, money; not Calendar, which is always first) from the caller's main nav into the More menu, or bring it back (hidden:false). Nothing is deleted and the pages still work.",
  async run(ctx, i) { return { section: i.section, hidden: i.hidden, hiddenSections: await setSectionHidden(ctx.uid, ctx.role, i.section, i.hidden) }; },
});
export const sectionsHidden = defineCommand({
  name: "sections.hidden", roles: ["admin", "member"], input: z.strictObject({}),
  description: "Which main sections the caller has tucked into the More menu.",
  async run(ctx) { return { hiddenSections: await hiddenSections(ctx.uid, ctx.role) }; },
});

export const sectionsSetOrder = defineCommand({
  name: "sections.setOrder", roles: ["admin", "member"], input: SectionOrderInput,
  description: "Set the order of the caller's main sections after Calendar, which is always first (shows, booking, templates, songs, setlists, rehearsals, money). Sections left out go to the end in their default order.",
  async run(ctx, i) { return { order: await setSectionOrder(ctx.uid, i.order) }; },
});
export const sectionsOrder = defineCommand({
  name: "sections.order", roles: ["admin", "member"], input: z.strictObject({}),
  description: "The order of the caller's main sections.",
  async run(ctx) { return { order: await sectionOrder(ctx.uid) }; },
});

const artistOf = async (ctx: Parameters<typeof callerArtistId>[0]) => {
  const id = await callerArtistId(ctx);
  if (!id) throw new AppError("invalid_input", "Which artist? Open one first", 400);
  return id;
};
export const setlistsPrintPrefs = defineCommand({
  name: "setlists.printPrefs", roles: ["admin", "member"], input: z.strictObject({}),
  description: "How the caller last printed a setlist for this artist (copy, sheets, fields, titles, header, paper); options is null if they never did.",
  async run(ctx) { return { options: await printPrefs(ctx.uid, await artistOf(ctx)) }; },
});
export const setlistsSetPrintPrefs = defineCommand({
  name: "setlists.setPrintPrefs", roles: ["admin", "member"], input: z.strictObject({ options: PrintOptions }),
  description: "Remember how the caller prints setlists for this artist; the Print dialog and setlists.printLink start from it. Personal: nobody else's prints change.",
  async run(ctx, i) { await setPrintPrefs(ctx.uid, await artistOf(ctx), i.options); return { options: i.options }; },
});

export const prefsCommands = [sectionsSetHidden, sectionsHidden, sectionsSetOrder, sectionsOrder, setlistsPrintPrefs, setlistsSetPrintPrefs];
