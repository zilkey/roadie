/** The seeded people. Shared by scripts/seed.ts and the dev "Sign in as…" buttons. */
export interface DevPerson { key: string; name: string; email: string; role: "admin" | "member"; instruments: string[] }
export const DEV_PEOPLE: DevPerson[] = [
  { key: "rudy", name: "Rudy", email: "rudy@example.com", role: "admin", instruments: ["keys"] },
  { key: "nora", name: "Nora", email: "nora@example.com", role: "admin", instruments: ["vocals", "guitar"] },
  { key: "hugo", name: "Hugo", email: "hugo@example.com", role: "member", instruments: ["bass"] },
  { key: "felix", name: "Felix", email: "felix@example.com", role: "member", instruments: ["drums"] },
  { key: "iris", name: "Iris", email: "iris@example.com", role: "member", instruments: ["violin", "vocals"] },
];
/** Not invited: used to test the turn-away path. */
export const DEV_STRANGER = { key: "stranger", name: "Pat Stranger", email: "stranger@example.com" };
/** A second band that shares the venue directory with the first (scripts/seed.ts): an admin of its own, with her own private venue notes. */
export const DEV_OTHER_BAND = { artistName: "Fern Valley Trio", person: { key: "olga", name: "Olga Park", email: "olga@example.com", role: "admin", instruments: ["guitar"] } as DevPerson };
