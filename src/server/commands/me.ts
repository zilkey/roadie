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

export const geoAutocomplete = defineCommand({
  name: "geo.autocomplete", roles: ["admin", "member", "mcp"],
  description: "Address and place typeahead (OpenRouteService through the server; the key never reaches the client). " +
    "Returns suggestions with name, address, lat and lng — what rehearsal locations, home addresses and typed gas trips are saved as. The UI debounces calls at 300 ms.",
  input: z.strictObject({ q: z.string().trim().min(3) }),
  async run(_ctx, i): Promise<{ suggestions: OrsPlace[] }> {
    const suggestions = await orsClient().autocomplete(i.q);
    return { suggestions: suggestions.slice(0, 8) };
  },
});

export const meCommands = [meUpdateDriving, geoAutocomplete];
