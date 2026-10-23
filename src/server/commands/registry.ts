import type { Command } from "./types";
import { peopleCommands } from "./people";
import { bookingCommands } from "./booking";
import { showCommands } from "./shows";
import { availabilityCommands } from "./availability";

/** Every command. Slices append their arrays here. */
const all = [...peopleCommands, ...bookingCommands, ...showCommands, ...availabilityCommands] as Command[];

export const registry: Record<string, Command> = Object.fromEntries(all.map((c) => [c.name, c]));
export const commandNames = Object.keys(registry);
