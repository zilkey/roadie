import type { Command } from "./types";
import { peopleCommands } from "./people";
import { bookingCommands } from "./booking";
import { emailCommands } from "./email";
import { showCommands } from "./shows";
import { availabilityCommands } from "./availability";
import { fanCommands } from "./fans";
import { musicCommands } from "./music";
import { moneyCommands } from "./money";
import { projectCommands } from "./projects";
import { releaseCommands } from "./releases";
import { statsCommands } from "./stats";
import { aiCommands } from "./ai";
import { draftCommands } from "./drafts";
import { assistantCommands } from "./assistant";
import { prefsCommands } from "./prefs";
import { printCommands } from "./print";
import { stagePlotCommands } from "./stagePlots";
import { meCommands } from "./me";
import { helpCommands } from "./help";
import { googleCommands } from "./google";
import { recordingCommands } from "./recordings";
import { showPosterCommands } from "./showPosters";

/** Every command. Slices append their arrays here. */
const all = [...peopleCommands, ...bookingCommands, ...emailCommands, ...showCommands, ...availabilityCommands, ...fanCommands, ...musicCommands, ...moneyCommands, ...projectCommands, ...releaseCommands, ...statsCommands, ...aiCommands, ...assistantCommands, ...draftCommands, ...prefsCommands, ...printCommands, ...stagePlotCommands, ...meCommands, ...helpCommands, ...googleCommands, ...emailCommands, ...recordingCommands, ...showPosterCommands] as Command[];

export const registry: Record<string, Command> = Object.fromEntries(all.map((c) => [c.name, c]));
export const commandNames = Object.keys(registry);
