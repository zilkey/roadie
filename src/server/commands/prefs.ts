import { z } from "zod";
import { SectionOrderInput, SectionSetInput } from "@/schema/sections";
import { hiddenSections, sectionOrder, setSectionHidden, setSectionOrder } from "../prefs";
import { defineCommand } from "./types";

export const sectionsSetHidden = defineCommand({
  name: "sections.setHidden", roles: ["admin", "member"], input: SectionSetInput,
  description: "Hide a main section (booking, templates, shows, songs, money) from the caller's main nav into the More menu, or bring it back (hidden:false). Nothing is deleted and the pages still work.",
  async run(ctx, i) { return { section: i.section, hidden: i.hidden, hiddenSections: await setSectionHidden(ctx.uid, i.section, i.hidden) }; },
});
export const sectionsHidden = defineCommand({
  name: "sections.hidden", roles: ["admin", "member"], input: z.strictObject({}),
  description: "Which main sections the caller has tucked into the More menu.",
  async run(ctx) { return { hiddenSections: await hiddenSections(ctx.uid) }; },
});

export const sectionsSetOrder = defineCommand({
  name: "sections.setOrder", roles: ["admin", "member"], input: SectionOrderInput,
  description: "Set the order of the caller's main sections after Home (shows, booking, templates, songs, money). Sections left out go to the end in their default order.",
  async run(ctx, i) { return { order: await setSectionOrder(ctx.uid, i.order) }; },
});
export const sectionsOrder = defineCommand({
  name: "sections.order", roles: ["admin", "member"], input: z.strictObject({}),
  description: "The order of the caller's main sections after Home.",
  async run(ctx) { return { order: await sectionOrder(ctx.uid) }; },
});

export const prefsCommands = [sectionsSetHidden, sectionsHidden, sectionsSetOrder, sectionsOrder];
