import type { Command } from "./types";
import { peopleCommands } from "./people";
import { bookingCommands } from "./booking";
import { showCommands } from "./shows";
import { availabilityCommands } from "./availability";
import { musicCommands } from "./music";
import { moneyCommands } from "./money";
import { statsCommands } from "./stats";
import { aiCommands } from "./ai";
import { draftCommands } from "./drafts";
import { assistantCommands } from "./assistant";
import { prefsCommands } from "./prefs";
import { meCommands } from "./me";
import { helpCommands } from "./help";

/** Every command. Slices append their arrays here. */
const all = [...peopleCommands, ...bookingCommands, ...showCommands, ...availabilityCommands, ...musicCommands, ...moneyCommands, ...statsCommands, ...aiCommands, ...assistantCommands, ...draftCommands, ...prefsCommands, ...meCommands, ...helpCommands] as Command[];

export const registry: Record<string, Command> = Object.fromEntries(all.map((c) => [c.name, c]));
export const commandNames = Object.keys(registry);
