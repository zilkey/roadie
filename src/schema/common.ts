import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const id = z.string().min(1);
/** Calendar date, YYYY-MM-DD */
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** Clock time, 24h HH:MM */
export const timeStr = z.string().regex(/^\d{1,2}:\d{2}$/, "Use HH:MM (24h)");
/** Integer cents */
export const cents = z.number().int();
export const email = z.string().email().refine((s) => s === s.toLowerCase(), "Email must be lowercase");

/** A Firestore Timestamp (admin or client SDK) or Date. */
export type TimestampLike = { toDate(): Date; toMillis(): number };
export const ts = z.custom<TimestampLike | Date>(
  (v) => v instanceof Date || (!!v && typeof v === "object" && typeof (v as TimestampLike).toMillis === "function"),
  "Expected a timestamp",
);

/** "shortcut": the iOS Shortcut, through a shortcut token (src/server/shortcut.ts). */
export const via = z.enum(["app", "mcp", "import", "assistant", "shortcut"]);
export type Via = z.infer<typeof via>;

export const source = z.strictObject({ url: z.string().url(), checkedAt: z.string(), note: z.string().optional() });

export const region = z.enum(["boulder", "denver", "north", "south", "mountains", "southwest", "out"]);
/** Where money in came from (income.category). */
export const incomeCategory = z.enum(["guarantee", "door", "tips", "merch", "streaming", "digitalSales", "physical", "preorders", "crowdfunding", "sync", "grant", "gearSale", "other"]);
export type IncomeCategory = z.infer<typeof incomeCategory>;
/** What money out was for (expenses.category). */
export const expenseCategory = z.enum([
  "gear", "travel", "lodging", "food", "recording", "mixing", "mastering", "pressing", "artwork", "photo", "video", "space", "marketing", "fees", "other",
]);
export type ExpenseCategory = z.infer<typeof expenseCategory>;
/** How money moved (income.method, payouts.method): no accounts, just the way it was paid. */
export const paymentMethod = z.enum(["cash", "venmo", "check", "square", "card", "bank", "other"]);
export type PaymentMethod = z.infer<typeof paymentMethod>;
/**
 * @deprecated The old one-list ledger category, from when income lived on the show's deal. Expenses written before
 * `npm run migrate:money` may still carry one of its income values (guarantee, door, merch, tips, venmo); readers map
 * those to "other". Use incomeCategory / expenseCategory. Removed once nothing imports it.
 */
export const ledgerCategory = z.enum([
  "guarantee", "door", "merch", "tips", "venmo", "photo", "video", "space", "gear", "marketing", "travel", "fees", "other",
]);
export const gearItem = z.strictObject({ label: z.string().min(1), musicianId: id.optional() });
export const sound = z.strictObject({ provider: z.enum(["venueProvided", "bandProvided"]), notes: z.string().optional() });
export const driveRef = z.strictObject({ driveFileId: z.string(), url: z.string() });

/** Fields stamped by db.ts on every document. */
export const commonShape = {
  id,
  schemaVersion: z.number().int(),
  createdAt: ts,
  updatedAt: ts,
  createdBy: z.string(),
  updatedBy: z.string(),
  via,
  runId: z.string(),
  deletedAt: ts.nullable(),
  /** +1 on every write (create = 1). Documents written before this existed have none: treat as 0. */
  rev: z.number().int().optional(),
};
export const commonKeys = Object.keys(commonShape) as (keyof typeof commonShape)[];
/** Mask to `.omit()` the server-stamped fields to get the input schema. */
export const serverMask = {
  id: true, schemaVersion: true, createdAt: true, updatedAt: true, createdBy: true, updatedBy: true,
  via: true, runId: true, deletedAt: true, rev: true,
} as const;

/** Booking data keeps where each fact came from. */
export const sourcesShape = { sources: z.array(source).optional() };

export function entity<S extends z.ZodRawShape>(shape: S) {
  return z.strictObject({ ...commonShape, ...shape });
}
export type Entity<T extends z.ZodType> = z.infer<T>;
