/**
 * The caller's own stuff (My settings) and the geo typeahead. Driving settings live at users/{uid}/private/driving,
 * written through src/server/driving.ts (admin SDK, no history — see that module); only the owner reads the doc,
 * so the page reads it straight from Firestore and saves through me.updateDriving.
 */
import { z } from "zod";
import { geoPoint, fuelGrade, type DrivingSettings } from "@/schema";
import { defineCommand } from "./types";
import { orsClient, type OrsPlace } from "../integrations";
import { updateDriving } from "../driving";
import { db } from "../db";
import { AppError } from "../errors";
import type { Membership } from "@/schema";

export const meUpdateDriving = defineCommand({
  name: "me.updateDriving", roles: ["admin", "member"],
  description: "Save the caller's OWN Driving & gas settings (My settings): home address (with coordinates, from geo.autocomplete), car name, MPG, fuel grade. " +
    "null clears a field. Never changes anyone else's settings. The home address stays private to its owner; gas expenses store miles, not the address.",
  input: z.strictObject({
    home: geoPoint.nullable().optional(),
    carName: z.string().trim().min(1).nullable().optional(),
    mpg: z.number().positive().nullable().optional(),
    fuelGrade: fuelGrade.optional(),
  }),
  async run(ctx, i): Promise<DrivingSettings> {
    return updateDriving(ctx.uid, i);
  },
});

/**
 * An admin (or the MCP connector, which acts for one) saves a bandmate's Driving & gas settings, so their gas estimates
 * use their own home and car. Same private doc and no history as me.updateDriving (see driving.ts): it can't be undone
 * with history.undoRun, so the reply says what is now saved.
 */
export const peopleUpdateDriving = defineCommand({
  name: "people.updateDriving", roles: ["admin", "mcp"],
  description: "Save a band member's Driving & gas settings, used by expenses.estimateGas (forId) and gas expenses: home address (with coordinates, from geo.autocomplete), car name (\"2010 Honda Fit\"), MPG, fuel grade (regular|midgrade|premium|diesel). " +
    "userId is whose (context.now band[].userId, or a records.get user). null clears a field. Not undoable with history.undoRun; the reply is what is now saved. The home address stays private: it is never put on an expense.",
  input: z.strictObject({
    userId: z.string().min(1),
    home: geoPoint.nullable().optional(),
    carName: z.string().trim().min(1).nullable().optional(),
    mpg: z.number().positive().nullable().optional(),
    fuelGrade: fuelGrade.optional(),
  }),
  async run(ctx, { userId, ...patch }): Promise<DrivingSettings> {
    const u = await db.get("users", userId);
    if (!u || u.deletedAt || (ctx.artistId && !((u.artists ?? []) as Membership[]).some((m) => m.artistId === ctx.artistId)))
      throw new AppError("not_found", "Not a member of this band", 404);
    return updateDriving(userId, patch);
  },
});

export const geoAutocomplete = defineCommand({
  name: "geo.autocomplete", roles: ["admin", "member", "mcp"],
  description: "Address and place typeahead (OpenRouteService through the server; the key never reaches the client). " +
    "Returns suggestions with name, address, lat and lng — what rehearsal locations, home addresses and typed gas trips are saved as. The UI debounces calls at 300 ms.",
  input: z.strictObject({ q: z.string().trim().min(3) }),
  async run(_ctx, i): Promise<{ suggestions: OrsPlace[] }> {
    // No ORS key (or ORS down): no suggestions rather than an error, so the fields still take typed text and the
    // gas form falls back to a typed amount.
    try {
      const suggestions = await orsClient().autocomplete(i.q);
      return { suggestions: suggestions.slice(0, 8) };
    } catch {
      return { suggestions: [] };
    }
  },
});

export const meCommands = [meUpdateDriving, peopleUpdateDriving, geoAutocomplete];
