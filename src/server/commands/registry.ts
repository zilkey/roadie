import type { Command } from "./types";
import { peopleCommands } from "./people";

/** Every command. Slices append their arrays here. */
const all = [...peopleCommands] as Command[];

export const registry: Record<string, Command> = Object.fromEntries(all.map((c) => [c.name, c]));
export const commandNames = Object.keys(registry);
