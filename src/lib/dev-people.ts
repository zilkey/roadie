/** The seeded people. Shared by scripts/seed.ts and the dev "Sign in as…" buttons. */
export interface DevPerson { key: string; name: string; email: string; role: "admin" | "member"; instruments: string[] }
export const DEV_PEOPLE: DevPerson[] = [
  { key: "jeff", name: "Jeff", email: "jeff@example.com", role: "admin", instruments: ["keys"] },
  { key: "ingrid", name: "Ingrid", email: "ingrid@example.com", role: "admin", instruments: ["vocals", "guitar"] },
  { key: "david", name: "David", email: "david@example.com", role: "member", instruments: ["bass"] },
  { key: "eric", name: "Eric", email: "eric@example.com", role: "member", instruments: ["drums"] },
  { key: "emma", name: "Emma", email: "emma@example.com", role: "member", instruments: ["violin", "vocals"] },
];
/** Not invited: used to test the turn-away path. */
export const DEV_STRANGER = { key: "stranger", name: "Pat Stranger", email: "stranger@example.com" };
