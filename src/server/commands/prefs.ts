import { z } from "zod";
import { SectionSetInput } from "@/schema/sections";
import { hiddenSections, setSectionHidden } from "../prefs";
import { defineCommand } from "./types";

export const sectionsSetHidden = defineCommand({
  name: "sections.setHidden", roles: ["admin", "member"], input: SectionSetInput,
  description: "Hide a main section (booking, shows, songs, money) from the caller's main nav into the More menu, or bring it back (hidden:false). Nothing is deleted and the pages still work.",
  async run(ctx, i) { return { section: i.section, hidden: i.hidden, hiddenSections: await setSectionHidden(ctx.uid, i.section, i.hidden) }; },
});
export const sectionsHidden = defineCommand({
  name: "sections.hidden", roles: ["admin", "member"], input: z.strictObject({}),
  description: "Which main sections the caller has tucked into the More menu.",
  async run(ctx) { return { hiddenSections: await hiddenSections(ctx.uid) }; },
});

export const prefsCommands = [sectionsSetHidden, sectionsHidden];
