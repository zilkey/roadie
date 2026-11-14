/**
 * The caller's own stuff (My settings) and the geo typeahead. Driving settings live on the person's users doc
 * (users/{uid}.driving), written through src/server/driving.ts like any other field: history, and history.undoRun puts them back.
 */
import { z } from "zod";
import { geoPoint, fuelGrade, type DrivingSettings } from "@/schema";
import { defineCommand } from "./types";
import { orsClient, type OrsPlace } from "../integrations";
import { updateDriving } from "../driving";
import { db } from "../db";
import { AppError } from "../errors";
import type { Membership } from "@/schema";

/** A car in a driving patch: no id = a new car; an id = that saved car (its MPG kept unless sent; null clears it). */
const carIn = z.strictObject({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, "Name the car"),
  mpg: z.number().positive().nullable().optional(),
  fuelGrade: fuelGrade.optional(),
});
const drivingPatch = {
  home: geoPoint.nullable().optional(),
  cars: z.array(carIn).optional(),
};
const PATCH_DESC = "home is the address with coordinates (from geo.autocomplete; null clears it). cars is the WHOLE list, in order: " +
  "each { id (keep an existing car; leave out for a new one), name (\"2010 Honda Fit\"), mpg, fuelGrade (regular|midgrade|premium|diesel, default regular) }; cars left out are removed. " +
  "Send only what changes. With one car, gas estimates use it; with several they ask which (expenses.estimateGas carId).";

export const meUpdateDriving = defineCommand({
  name: "me.updateDriving", roles: ["admin", "member"],
  description: "Save the caller's OWN Driving & gas settings (My settings), used by gas estimates. " + PATCH_DESC + " Never changes anyone else's settings. Undoable with history.undoRun.",
  input: z.strictObject(drivingPatch),
  async run(ctx, i): Promise<DrivingSettings> {
    return updateDriving(ctx, ctx.uid, i);
  },
});

/** An admin (or the MCP connector, which acts for one) saves a bandmate's Driving & gas settings, so their gas estimates use their own home and car. */
export const peopleUpdateDriving = defineCommand({
  name: "people.updateDriving", roles: ["admin", "mcp"],
  description: "Save a band member's Driving & gas settings, used by expenses.estimateGas (forId) and gas expenses. " +
    "userId is whose (context.now band[].userId, or a records.get user). " + PATCH_DESC + " The reply is what is now saved (with each car's id). Undoable with history.undoRun.",
  input: z.strictObject({ userId: z.string().min(1), ...drivingPatch }),
  async run(ctx, { userId, ...patch }): Promise<DrivingSettings> {
    const u = await db.get("users", userId);
    if (!u || u.deletedAt || (ctx.artistId && !((u.artists ?? []) as Membership[]).some((m) => m.artistId === ctx.artistId)))
      throw new AppError("not_found", "Not a member of this band", 404);
    return updateDriving(ctx, userId, patch);
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
