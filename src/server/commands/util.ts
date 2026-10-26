import { z } from "zod";

/**
 * `{id, patch}` input where every field of `shape` may be set, or set to null to clear it. A create schema's defaults (`.default([])`)
 * are dropped: a key the patch leaves out stays as it is, it is not reset to the default.
 */
export function patchInput<T extends z.ZodObject>(schema: T) {
  const patch: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(schema.shape)) {
    let t = v as z.ZodType;
    while (t instanceof z.ZodDefault) t = t.unwrap() as z.ZodType;
    patch[k] = t.nullable().optional();
  }
  return z.strictObject({ id: z.string().min(1), patch: z.strictObject(patch) });
}
export const idInput = z.strictObject({ id: z.string().min(1) });
