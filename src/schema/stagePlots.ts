import { z } from "zod";
import { entity, serverMask, id } from "./common";
import { ICON_TYPES } from "@/lib/stagePlots/icons";

/**
 * Positions are in feet, as the design draws them: x from the stage-right edge (the LEFT of the drawing), y from the upstage
 * edge (the TOP), growing toward the audience at the bottom. Feet from the front/downstage edge = depthFt - y.
 */
const ft = z.number().finite();

/** One input channel. Array order = channel order. No x/y = not placed yet (its circle waits in the strip). The input IS its circle. */
export const StagePlotInput = z.strictObject({
  id,
  x: ft.optional(), y: ft.optional(),
  source: z.string().optional(),
  /** Mic or DI ("SM57", "DI"). */
  gear: z.string().optional(),
  stand: z.string().optional(),
  phantom: z.boolean().optional(),
  musicianId: id.optional(),
  note: z.string().optional(),
});
/** Gear icon from the tray. */
export const StagePlotItem = z.strictObject({
  id,
  type: z.enum(ICON_TYPES),
  x: ft, y: ft,
  /** Degrees. */
  rot: z.number().finite(),
  musicianId: id.optional(),
  label: z.string().optional(),
});
export const monitorKind = z.enum(["wedge", "iem", "sidefill"]);
/** One monitor mix, numbered by array order (M1...Mn). Placed like an input: no x/y = in the strip. */
export const StagePlotMonitor = z.strictObject({
  id,
  kind: monitorKind,
  musicianId: id.optional(),
  x: ft.optional(), y: ft.optional(),
  wants: z.string().optional(),
});
/** The engineer link: only a SHA-256 hash of the token is stored (see src/server/stagePlotShare.ts). */
export const StagePlotShare = z.strictObject({ on: z.boolean(), tokenHash: z.string().optional(), at: z.string().optional() });

/** stagePlots/{autoId}: one plot, optionally for one lineup (configurationId, a label and filter). */
export const StagePlot = entity({
  artistId: id.optional(),
  name: z.string().min(1),
  configurationId: id.optional(),
  stage: z.strictObject({ widthFt: z.number().positive(), depthFt: z.number().positive() }),
  inputs: z.array(StagePlotInput),
  items: z.array(StagePlotItem),
  monitors: z.array(StagePlotMonitor),
  bring: z.string().optional(),
  need: z.string().optional(),
  /** Bumped only by changes to inputs, mixes, bring/need and stage size: never by moving, adding gear or renaming. Starts at 1. */
  version: z.number().int(),
  share: StagePlotShare.optional(),
});
export const StagePlotDocInput = StagePlot.omit(serverMask);
export type StagePlot = z.infer<typeof StagePlot>;
export type StagePlotInput = z.infer<typeof StagePlotInput>;
export type StagePlotItem = z.infer<typeof StagePlotItem>;
export type StagePlotMonitor = z.infer<typeof StagePlotMonitor>;
/** The part of a plot the renderer and plot.ts need. */
export type PlotShape = Pick<StagePlot, "stage" | "inputs" | "items" | "monitors"> & Partial<Pick<StagePlot, "bring" | "need" | "name" | "version">>;
