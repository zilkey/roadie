import { z } from "zod";

/** `{id, patch}` input where every field of `shape` may be set, or set to null to clear it. */
export function patchInput<T extends z.ZodObject>(schema: T) {
  const patch: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(schema.shape)) patch[k] = (v as z.ZodType).nullable().optional();
  return z.strictObject({ id: z.string().min(1), patch: z.strictObject(patch) });
}
export const idInput = z.strictObject({ id: z.string().min(1) });
