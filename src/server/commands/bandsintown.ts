import { z } from "zod";
import { defineCommand } from "./types";
import { AppError } from "../errors";
import { checkBandsintown } from "../bandsintown";

// Bandsintown is read-only from Roadie: this looks at the band's listed events and ticks the "Add to Bandsintown" items it finds.
// The app runs it when an admin opens a show or To Dos; not Roadie's (no "mcp").

export const bandsintownCheck = defineCommand({
  name: "bandsintown.check", roles: ["admin"],
  description: "Look at the band's upcoming events on Bandsintown and tick the \"Add to Bandsintown\" item on each show listed there (same date, same city or venue). showId: just that show. " +
    "Returns {ticked: showIds, skipped: 'no_key' when General Settings has no Bandsintown artist ID and API key}.",
  input: z.strictObject({ showId: z.string().min(1).optional() }),
  async run(ctx, i) {
    if (!ctx.artistId) throw new AppError("invalid_input", "Which artist? Open one first", 400);
    try { return await checkBandsintown(ctx, ctx.artistId, i.showId); }
    catch (e) { throw new AppError("integration", e instanceof Error ? e.message : String(e), 502); }
  },
});

export const bandsintownCommands = [bandsintownCheck];
